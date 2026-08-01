/**
 * 안전 점수 엔진 테스트 — 쾌적층(TCI) − 안전층 모델.
 * SafetyScore = TCI(체감·강수·미먼·바람) − 안전(산불·산사태·의료) − 이동. 재난경보급은 감점 앵커로 총점 보장.
 */
import { describe, expect, it } from "vitest";
import { computeSafetyScore, ALERT_BAND_CAP } from "@/lib/safety/score";
import { gradeForScore } from "@/lib/safety/weights";
import type {
  Profile,
  RiskBreakdown,
  RiskFactorKey,
  RiskInput,
} from "@/lib/safety/types";
import type { PlaceEnvType } from "@/lib/tour/types";

/** 이상적 봄날 기본 입력 (체감 21℃·무강수·청정·미풍·응급실 5km) */
const CLEAR: RiskInput = {
  tempC: 21,
  rainProbPct: 10,
  windMs: 2,
  pm25: 10,
  forestFireLevel: 1,
  emergencyRoomKm: 5,
};

function run(
  input: Partial<RiskInput>,
  envType: PlaceEnvType = "outdoor_general",
  profile: Profile = "default",
): RiskBreakdown {
  return computeSafetyScore({ ...CLEAR, ...input }, { envType }, profile);
}

function factor(b: RiskBreakdown, key: RiskFactorKey) {
  const f = b.factors.find((f) => f.key === key);
  if (!f) throw new Error(`factor ${key} 없음`);
  return f;
}

describe("computeSafetyScore — 기본/구조", () => {
  it("이상적 봄날은 90점 이상, grade low", () => {
    const b = run({});
    expect(b.score).toBeGreaterThanOrEqual(90);
    expect(b.grade).toBe("low");
  });

  it("체감온도/강수·바람/미세먼지/산불/응급의료 요인은 항상 포함", () => {
    const keys = run({}).factors.map((f) => f.key);
    for (const k of ["heat", "rain", "wind", "pm", "forest_fire", "medical"]) {
      expect(keys).toContain(k);
    }
  });

  it("모든 요인 points는 0 이상의 정수", () => {
    const b = run(
      { tempC: 36, apparentTempC: 38, rainProbPct: 85, rainMm: 70, windMs: 15, pm25: 80, forestFireLevel: 3, emergencyRoomKm: 35, shelterKm: 8 },
      "outdoor_water",
      "with_kids",
    );
    for (const f of b.factors) {
      expect(Number.isInteger(f.points)).toBe(true);
      expect(f.points).toBeGreaterThanOrEqual(0);
    }
  });

  it("체감온도(apparentTempC)가 있으면 그것으로 열쾌적 평가 (건구 tempC 대신)", () => {
    // 건구 30℃지만 체감 36℃ → 무더위로 큰 감점
    const dry = factor(run({ tempC: 30, apparentTempC: 30 }), "heat").points;
    const humid = factor(run({ tempC: 30, apparentTempC: 36 }), "heat").points;
    expect(humid).toBeGreaterThan(dry);
  });
});

describe("쾌적층(TCI) — 계절 패턴", () => {
  it("한여름 무더위(체감35)는 봄날보다 점수 크게 낮다", () => {
    const spring = run({ tempC: 21 }).score;
    const summer = run({ tempC: 35 }).score;
    expect(summer).toBeLessThan(spring - 20);
  });

  it("체감온도 오를수록 heat 감점 증가(26→31→35)", () => {
    const p26 = factor(run({ tempC: 26 }), "heat").points;
    const p31 = factor(run({ tempC: 31 }), "heat").points;
    const p35 = factor(run({ tempC: 35 }), "heat").points;
    expect(p31).toBeGreaterThan(p26);
    expect(p35).toBeGreaterThan(p31);
  });

  it("실내는 같은 무더위에 감점 작다(×0.3) → 점수 높다", () => {
    const outdoor = run({ tempC: 35 });
    const indoor = run({ tempC: 35 }, "indoor");
    expect(factor(indoor, "heat").points).toBeLessThan(factor(outdoor, "heat").points);
    expect(indoor.score).toBeGreaterThan(outdoor.score);
  });

  it("계곡(outdoor_water)은 비 올 때 강수 감점 크다(강수 ×1.5)", () => {
    const general = factor(run({ rainMm: 20, rainProbPct: 80 }), "rain").points;
    const water = factor(run({ rainMm: 20, rainProbPct: 80 }, "outdoor_water"), "rain").points;
    expect(water).toBeGreaterThan(general);
  });

  it("강수·바람은 별개 요인(KTCI 가중 분리) — rain_wind 합쳐진 요인 없음", () => {
    const keys = run({ rainProbPct: 80, windMs: 12 }).factors.map((f) => f.key);
    expect(keys).toContain("rain");
    expect(keys).toContain("wind");
    expect(keys).not.toContain("rain_wind");
  });

  it("흐린 날 일조 감점은 강수확률 높으면 완화(이중 페널티 방지)", () => {
    // 흐림(sunHours 1) 고정, 강수확률만 달리 — 낮으면 감점 유지, 높으면 0
    const dry = factor(run({ sunHours: 1, rainProbPct: 10 }), "sun").points;
    const mid = factor(run({ sunHours: 1, rainProbPct: 45 }), "sun").points;
    const wet = factor(run({ sunHours: 1, rainProbPct: 80 }), "sun").points;
    expect(dry).toBeGreaterThan(0); // 비 안 오는 흐림 → 일조 감점 유효
    expect(mid).toBeLessThan(dry); // 30~59% → 절반
    expect(wet).toBe(0); // ≥60% → 강수 축이 담당, 일조 중복 제거
  });

  it("미세먼지 매우나쁨은 pm 감점, 민감층(with_kids)은 더 크다", () => {
    const base = factor(run({ pm25: 120 }), "pm").points;
    const kids = factor(run({ pm25: 120 }, "outdoor_general", "with_kids"), "pm").points;
    expect(base).toBeGreaterThan(0);
    expect(kids).toBeGreaterThan(base);
  });

  it("비 오면 같은 조건보다 점수 하락", () => {
    const dry = run({ rainMm: 0 }).score;
    const wet = run({ rainMm: 20, rainProbPct: 80 }).score;
    expect(wet).toBeLessThan(dry);
  });
});

describe("안전층 — 산불·산사태·응급의료", () => {
  it("산불 1단계는 감점 0, 3단계는 감점 발생", () => {
    expect(factor(run({ forestFireLevel: 1 }), "forest_fire").points).toBe(0);
    expect(factor(run({ forestFireLevel: 3 }), "forest_fire").points).toBeGreaterThan(0);
  });

  it("산불 단계가 여행 등급을 보장 — 높음→주의, 매우높음→방문자제(지형 무관)", () => {
    // 감점(0/15/45/80)이 100점 만점 기준이라 그 자체가 등급을 강제한다
    expect(run({ forestFireLevel: 3 }).grade).toBe("moderate"); // 주의
    expect(run({ forestFireLevel: 4 }).grade).toBe("high"); // 방문 자제
    expect(run({ forestFireLevel: 4 }, "indoor").grade).toBe("high"); // 실내도 대피급
  });

  it("산사태: 비 안 오면 요인 없음, 공식 경보(2)는 요인 발생", () => {
    expect(run({ rainMm: 0 }, "outdoor_mountain").factors.some((f) => f.key === "landslide")).toBe(false);
    expect(run({ landslideLevel: 2 }, "outdoor_mountain").factors.some((f) => f.key === "landslide")).toBe(true);
  });

  it("호우(침수·급류)는 안전층 별도 요인 — rainMm<30 없음, 호우급은 발생하고 disasterRisk에 포함", () => {
    expect(run({ rainMm: 10 }).factors.some((f) => f.key === "heavy_rain")).toBe(false);
    const heavy = run({ rainMm: 95, rainProbPct: 90 });
    const hr = heavy.factors.find((f) => f.key === "heavy_rain");
    expect(hr).toBeDefined();
    expect(hr!.points).toBeGreaterThan(0);
    // 쾌적(weather) 아닌 안전(disaster) 층으로 집계되는지
    expect(heavy.disasterRisk).toBeGreaterThanOrEqual(hr!.points);
    expect(factor(heavy, "rain").points).toBeLessThanOrEqual(30); // 쾌적 강수 상한
  });

  it("응급의료 30km↑는 상한 10, with_seniors는 default보다 크다", () => {
    expect(factor(run({ emergencyRoomKm: 35 }), "medical").points).toBe(10);
    const base = factor(run({ emergencyRoomKm: 20 }), "medical").points;
    const seniors = factor(run({ emergencyRoomKm: 20 }, "outdoor_general", "with_seniors"), "medical").points;
    expect(seniors).toBeGreaterThan(base);
  });

  it("오지 응급의료(먼 병원)는 맑은 날에도 점수를 끌어내린다(취약성 상시)", () => {
    const near = run({ emergencyRoomKm: 5 }).score;
    const far = run({ emergencyRoomKm: 35 }).score;
    expect(far).toBeLessThan(near);
  });
});

describe("재난 경보급 — 감점 앵커로 총점 보장(별도 override 아님)", () => {
  it("산불 4단계(심각)는 다른 조건 무관하게 총점 ≤ ALERT_BAND_CAP", () => {
    const b = run({ tempC: 21, forestFireLevel: 4 }, "outdoor_mountain");
    expect(b.score).toBeLessThanOrEqual(ALERT_BAND_CAP);
    expect(b.grade).toBe("high");
  });

  it("산사태 경보(2)는 총점 ≤ ALERT_BAND_CAP", () => {
    const b = run({ landslideLevel: 2 }, "outdoor_mountain");
    expect(b.score).toBeLessThanOrEqual(ALERT_BAND_CAP);
  });

  it("호우로 산악 프록시 경보(2)면 폭우 계곡은 방문 자제 수준", () => {
    const b = run({ rainMm: 90, rainProbPct: 90 }, "outdoor_mountain");
    expect(b.score).toBeLessThanOrEqual(ALERT_BAND_CAP);
  });

  it("주의보급(산불 3·산사태 1)은 밴드 밖 — 감점만", () => {
    const b = run({ forestFireLevel: 3 });
    expect(b.score).toBeGreaterThan(ALERT_BAND_CAP);
  });
});

describe("shelter — 선택 입력", () => {
  it("미제공 시 요인 없음", () => {
    const b = run({});
    expect(b.factors.some((f) => f.key === "shelter")).toBe(false);
  });
});

describe("점수 일관성 / 등급", () => {
  // 재난 경보급 밴드에 안 드는 케이스들 (산불<4, 산사태<2)
  const cases: Array<[Partial<RiskInput>, PlaceEnvType, Profile]> = [
    [{}, "indoor", "default"],
    [{ tempC: 33, pm25: 50 }, "outdoor_general", "with_kids"],
    [{ rainMm: 20, rainProbPct: 85, windMs: 12 }, "outdoor_water", "default"],
    [{ forestFireLevel: 3, windMs: 10 }, "outdoor_mountain", "with_seniors"],
  ];

  it("score = 100 − 요인 감점 합, 소계 합 일치 (항상)", () => {
    for (const [input, env, profile] of cases) {
      const b = run(input, env, profile);
      const total = b.factors.reduce((s, f) => s + f.points, 0);
      expect(b.score).toBe(Math.max(0, Math.min(100, 100 - total)));
      expect(b.weatherRisk + b.disasterRisk + b.medicalRisk).toBe(total);
      expect(b.score).toBeGreaterThanOrEqual(0);
      expect(b.score).toBeLessThanOrEqual(100);
    }
  });

  it("카테고리 소계 = 해당 요인 points 합", () => {
    const b = run(
      { tempC: 33, rainMm: 10, rainProbPct: 70, pm25: 50, forestFireLevel: 3, shelterKm: 4 },
      "outdoor_mountain",
    );
    const sum = (keys: RiskFactorKey[]) =>
      b.factors.filter((f) => keys.includes(f.key)).reduce((s, f) => s + f.points, 0);
    expect(b.weatherRisk).toBe(sum(["heat", "rain", "wind", "pm", "sun"]));
    expect(b.disasterRisk).toBe(sum(["heavy_rain", "forest_fire", "landslide", "shelter"]));
    expect(b.medicalRisk).toBe(sum(["medical"]));
  });

  it("gradeForScore 경계: 70→low, 69→moderate, 40→moderate, 39→high", () => {
    expect(gradeForScore(70)).toBe("low");
    expect(gradeForScore(69)).toBe("moderate");
    expect(gradeForScore(40)).toBe("moderate");
    expect(gradeForScore(39)).toBe("high");
  });

  it("profile이 결과에 그대로 담긴다", () => {
    expect(run({}, "indoor", "with_kids").profile).toBe("with_kids");
    expect(run({}).profile).toBe("default");
  });
});

// 중기예보(D+4~) 입력 — 풍속·강수량·체감온도를 제공하지 않는다.
describe("풍속 미제공 — 요인 비표시 + 총점 무결성", () => {
  it("바람 요인이 생성되지 않는다 (일조 축과 동일 규칙)", () => {
    const keys = run({ windMs: undefined }).factors.map((f) => f.key);
    expect(keys).not.toContain("wind");
    expect(keys).toContain("rain"); // 나머지 기상 축은 그대로
  });

  it("요인 설명에 undefined가 새지 않는다", () => {
    for (const f of run({ windMs: undefined }).factors) {
      expect(f.description).not.toContain("undefined");
      expect(Number.isFinite(f.value)).toBe(true);
    }
  });

  it("weatherRisk는 여전히 표시 요인 합과 일치", () => {
    const b = run({ windMs: undefined, tempC: 33, rainProbPct: 70, pm25: 50 });
    const sum = b.factors
      .filter((f) => ["heat", "rain", "wind", "pm", "sun"].includes(f.key))
      .reduce((s, f) => s + f.points, 0);
    expect(b.weatherRisk).toBe(sum);
  });

  it("풍속 결측이 강풍으로 취급되지 않는다 (미풍보다 낮고 강풍보다 높은 점수)", () => {
    expect(run({ windMs: undefined }).score).toBeGreaterThan(run({ windMs: 15 }).score);
    expect(run({ windMs: undefined }).score).toBeLessThanOrEqual(run({ windMs: 0.5 }).score);
  });

  it("중기예보 조합(풍속·강수량·체감온도 없음)도 정상 점수", () => {
    const b = run({
      windMs: undefined,
      rainMm: undefined,
      apparentTempC: undefined,
      sunHours: 8,
    });
    expect(b.score).toBeGreaterThanOrEqual(0);
    expect(b.score).toBeLessThanOrEqual(100);
    expect(b.factors.map((f) => f.key)).not.toContain("heavy_rain"); // 강수량 없음 → 축 비활성
  });
});
