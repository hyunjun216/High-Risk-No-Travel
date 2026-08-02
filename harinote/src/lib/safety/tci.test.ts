import { describe, expect, it } from "vitest";
import {
  TCI_WEIGHTS,
  computeTci,
  computeTciBreakdown,
  pmScore,
  rainScore,
  sunScore,
  thermalScore,
  windScore,
  type TciInput,
} from "@/lib/safety/tci";

describe("windScore — Mieczkowski normal system (km/h)", () => {
  it("무풍(<2.88km/h)은 만점 5", () => {
    expect(windScore(0.5)).toBe(5.0); // 1.8km/h
  });
  it("강풍주의보(14m/s=50km/h)는 0점", () => {
    expect(windScore(14)).toBe(0);
  });
  it("풍속 커질수록 점수 단조 감소", () => {
    expect(windScore(1)).toBeGreaterThan(windScore(3));
    expect(windScore(3)).toBeGreaterThan(windScore(6));
  });
});

describe("rainScore — 박창용(2014) 일값 규칙", () => {
  it("5mm 이상은 0점", () => {
    expect(rainScore(5)).toBe(0);
    expect(rainScore(20)).toBe(0);
  });
  it("0.5mm 미만(사실상 무강수)은 만점 5", () => {
    expect(rainScore(0)).toBe(5);
    expect(rainScore(0.3)).toBe(5);
  });
  it("1mm면 4점(5-1)", () => {
    expect(rainScore(1)).toBe(4);
  });
  it("미제공(undefined)은 무강수로 5점", () => {
    expect(rainScore(undefined)).toBe(5);
  });

  it("강수량 없어도 강수확률 높으면 감점 (비 예보 반영)", () => {
    // "강수확률 80% + 강수없음"이 예보에 흔함 → 확률로 감점
    expect(rainScore(undefined, 80)).toBe(2);
    expect(rainScore(undefined, 60)).toBe(3);
    expect(rainScore(undefined, 30)).toBe(4);
    expect(rainScore(undefined, 10)).toBe(5); // 낮으면 감점 없음
  });

  it("강수량·강수확률 중 나쁜 쪽 반영", () => {
    // 많은 비(5mm↑)면 확률 무관 최저점, 적은 비+높은 확률이면 확률이 지배
    expect(rainScore(20, 30)).toBe(0);
    expect(rainScore(1, 80)).toBe(2); // 강수량 4점 vs 확률 2점 → 2
  });
});

describe("sunScore — 일조시간", () => {
  it("1시간 이하는 0점", () => {
    expect(sunScore(1)).toBe(0);
    expect(sunScore(0.5)).toBe(0);
  });
  it("10시간 초과는 5점", () => {
    expect(sunScore(11)).toBe(5);
  });
  it("5시간이면 2점((5-1)*0.5)", () => {
    expect(sunScore(5)).toBe(2);
  });
});

describe("pmScore — 환경부 PM2.5 등급", () => {
  it("좋음(≤15)=5, 매우나쁨(>75)=0", () => {
    expect(pmScore(10)).toBe(5);
    expect(pmScore(100)).toBe(0);
  });
  it("등급 낮아질수록 점수 감소", () => {
    expect(pmScore(10)).toBeGreaterThan(pmScore(30));
    expect(pmScore(30)).toBeGreaterThan(pmScore(50));
  });
});

describe("thermalScore — 체감온도 브리지", () => {
  it("18~25℃ 이상적 구간은 만점 5", () => {
    expect(thermalScore(21)).toBe(5);
  });
  it("한여름 무더위(체감 35℃+)는 음수로 급감", () => {
    expect(thermalScore(36)).toBeLessThan(0);
  });
  it("체감 높을수록 점수 감소(25→31→35)", () => {
    expect(thermalScore(25)).toBeGreaterThan(thermalScore(31));
    expect(thermalScore(31)).toBeGreaterThan(thermalScore(35));
  });
});

describe("축 배점과 감점의 관계 — 근거 체인의 코드 증명", () => {
  const ALL: TciInput = {
    feelsC: 21,
    rainMmDaily: 0,
    rainProbPct: 0,
    windMs: 1,
    pm25: 8,
    sunHours: 8,
  };

  it("5축이 모두 있으면 축 배점 = KTCI 가중 × 100", () => {
    // "각 축이 최대로 깎을 수 있는 점수 = 그 축의 실증 가중"이 성립해야
    // 발표에서 상한의 근거로 KTCI를 인용할 수 있다.
    const { shares } = computeTciBreakdown(ALL);
    for (const axis of ["thermal", "rain", "pm", "wind", "sun"] as const) {
      expect(shares[axis]).toBeCloseTo(TCI_WEIGHTS[axis] * 100, 6);
    }
  });

  it("감점은 배점을 넘지 않는다 — 열쾌적이 음수 구간이어도", () => {
    for (const feelsC of [-20, -3, 21, 37, 45]) {
      const { deductions, shares } = computeTciBreakdown({ ...ALL, feelsC });
      for (const axis of ["thermal", "rain", "pm", "wind", "sun"] as const) {
        expect(deductions[axis], `${axis} @ ${feelsC}℃`).toBeLessThanOrEqual(
          shares[axis] + 1e-9,
        );
        expect(deductions[axis]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("감점 합 + TCI = 100", () => {
    for (const feelsC of [-10, 21, 36, 45]) {
      const b = computeTciBreakdown({ ...ALL, feelsC, pm25: 90 });
      const sum = Object.values(b.deductions).reduce((a, v) => a + v, 0);
      expect(sum + b.tci).toBeCloseTo(100, 0);
    }
  });

  it("축이 결측이면 나머지 배점이 커진다 (재정규화)", () => {
    const full = computeTciBreakdown(ALL);
    const noWindSun = computeTciBreakdown({ ...ALL, windMs: undefined, sunHours: undefined });
    expect(noWindSun.shares.thermal).toBeGreaterThan(full.shares.thermal);
    expect(noWindSun.shares.wind).toBe(0);
    expect(noWindSun.shares.sun).toBe(0);
  });
});

describe("computeTci — 관광기후지수 0~100", () => {
  it("이상적 봄날(체감21·무강수·맑음·미풍·청정)은 상위 등급(≥80)", () => {
    const tci = computeTci({ feelsC: 21, rainMmDaily: 0, windMs: 1, pm25: 8, sunHours: 8 });
    expect(tci).toBeGreaterThanOrEqual(80);
  });

  it("한여름 무더위+비+미먼나쁨은 낮은 등급(<50)", () => {
    const tci = computeTci({ feelsC: 35, rainMmDaily: 10, windMs: 1, pm25: 45, sunHours: 4 });
    expect(tci).toBeLessThan(50);
  });

  it("무더위가 쾌청한 봄날보다 점수 낮다", () => {
    const spring = computeTci({ feelsC: 21, rainMmDaily: 0, windMs: 1, pm25: 8 });
    const summer = computeTci({ feelsC: 34, rainMmDaily: 3, windMs: 1, pm25: 40 });
    expect(summer).toBeLessThan(spring);
  });

  it("일조 미제공이어도 계산되고 0~100 범위", () => {
    const tci = computeTci({ feelsC: 21, rainMmDaily: 0, windMs: 2, pm25: 10 });
    expect(tci).toBeGreaterThanOrEqual(0);
    expect(tci).toBeLessThanOrEqual(100);
  });

  it("비 오면 같은 조건보다 점수 하락(강수 27% 비중)", () => {
    const dry = computeTci({ feelsC: 22, rainMmDaily: 0, windMs: 1, pm25: 10 });
    const wet = computeTci({ feelsC: 22, rainMmDaily: 5, windMs: 1, pm25: 10 });
    expect(wet).toBeLessThan(dry);
  });
});

// 중기예보(D+4~)는 풍속을 제공하지 않는다 — 일조와 같은 "축 제외 후 재정규화" 경로를 탄다.
// 가드가 빠지면 windScore(undefined)가 NaN 비교로 0점(강풍 최악)이 되어 조용히 감점된다.
describe("풍속 미제공 — 축 제외 후 재정규화", () => {
  const base = { feelsC: 21, rainMmDaily: 0, pm25: 10, sunHours: 8 };

  it("계산되고 0~100 범위 (NaN 아님)", () => {
    const tci = computeTci(base);
    expect(Number.isNaN(tci)).toBe(false);
    expect(tci).toBeGreaterThanOrEqual(0);
    expect(tci).toBeLessThanOrEqual(100);
  });

  it("무풍(최선)도 강풍(최악)도 아닌 중간 — 결측이 유불리로 새지 않는다", () => {
    const calm = computeTci({ ...base, windMs: 0.5 }); // windScore 5.0
    const gale = computeTci({ ...base, windMs: 14 }); // windScore 0
    const absent = computeTci(base);
    expect(absent).toBeLessThan(calm);
    expect(absent).toBeGreaterThan(gale);
  });

  it("wind 감점은 0", () => {
    expect(computeTciBreakdown(base).deductions.wind).toBe(0);
  });

  it("남은 축 배점이 재정규화로 커진다 (9% 몫을 나눠 가짐)", () => {
    const bad = { feelsC: 21, rainMmDaily: 0, pm25: 100, sunHours: 8 }; // pmScore 0 → 배점 전액 감점
    const withWind = computeTciBreakdown({ ...bad, windMs: 2 }).deductions.pm;
    const withoutWind = computeTciBreakdown(bad).deductions.pm;
    expect(withoutWind).toBeGreaterThan(withWind);
    expect(withoutWind).toBeCloseTo(withWind / (1 - 0.09), 1); // TCI_WEIGHTS.wind = 0.09
  });

  it("풍속·일조 둘 다 없어도(중기예보 최악 케이스) 3축으로 계산", () => {
    const tci = computeTci({ feelsC: 21, rainMmDaily: 0, pm25: 10 });
    expect(Number.isNaN(tci)).toBe(false);
    expect(tci).toBeGreaterThanOrEqual(80); // 남은 3축이 모두 좋으면 여전히 상위 등급
  });
});
