import { describe, expect, it } from "vitest";
import {
  MID_MAX_OFFSET,
  MID_MIN_OFFSET,
  MID_TA_REG_ID,
  combineMid,
  midLandRegId,
  pickMidBaseTime,
  wfToSunHours,
} from "@/lib/risk/kma-mid";
import { SIGUNGU_SEATS } from "@/lib/risk/regions";

/** KST 시각 문자열로 Date 생성 — 테스트 머신 타임존에 무관 */
function kst(iso: string): Date {
  return new Date(`${iso}+09:00`);
}

describe("MID_TA_REG_ID — 기상청 공식 예보구역코드 대응", () => {
  it("18개 시군이 빠짐없이 대응된다", () => {
    for (const code of Object.keys(SIGUNGU_SEATS).map(Number)) {
      expect(MID_TA_REG_ID[code], `시군 ${code} 누락`).toMatch(/^11D[12]\d{4}$/);
    }
    expect(Object.keys(MID_TA_REG_ID)).toHaveLength(18);
  });

  it("코드가 중복되지 않는다 — 시군마다 고유 지점", () => {
    const ids = Object.values(MID_TA_REG_ID);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("영동 시군은 11D2, 영서 시군은 11D1 계열", () => {
    // 기상청 분류: 태백(14)은 영동이다
    for (const c of [1, 2, 3, 4, 5, 7, 14]) expect(MID_TA_REG_ID[c]).toMatch(/^11D2/);
    for (const c of [6, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18]) {
      expect(MID_TA_REG_ID[c]).toMatch(/^11D1/);
    }
  });

  it("육상예보 구역은 영서·영동 둘뿐", () => {
    const regs = new Set(Object.keys(SIGUNGU_SEATS).map((c) => midLandRegId(Number(c))));
    expect(regs).toEqual(new Set(["11D10000", "11D20000"]));
  });
});

describe("pickMidBaseTime — 발표시각 06/18시", () => {
  it("KST 09:00 → 당일 06시 발표", () => {
    expect(pickMidBaseTime(kst("2026-08-03T09:00:00")).tmFc).toBe("202608030600");
  });

  it("KST 06:05 → 아직 06시 미반영, 전날 18시 발표", () => {
    expect(pickMidBaseTime(kst("2026-08-03T06:05:00")).tmFc).toBe("202608021800");
  });

  it("KST 20:00 → 당일 18시 발표", () => {
    expect(pickMidBaseTime(kst("2026-08-03T20:00:00")).tmFc).toBe("202608031800");
  });

  it("자정 직후는 전날 18시 발표 (월 경계)", () => {
    expect(pickMidBaseTime(kst("2026-08-01T00:30:00")).tmFc).toBe("202607311800");
  });
});

describe("wfToSunHours — 하늘상태 문자열 환산", () => {
  it("맑음 11h · 구름많음 4h · 흐림 1h (단기예보 SKY 환산과 눈금 일치)", () => {
    expect(wfToSunHours("맑음")).toBe(11);
    expect(wfToSunHours("구름많음")).toBe(4);
    expect(wfToSunHours("흐림")).toBe(1);
  });

  it("비·눈이 섞이면 흐림으로 본다", () => {
    expect(wfToSunHours("구름많고 비")).toBe(1);
    expect(wfToSunHours("흐리고 눈")).toBe(1);
  });

  it("모르는 문자열·빈값은 undefined — 축을 비활성으로 둔다", () => {
    expect(wfToSunHours(undefined)).toBeUndefined();
    expect(wfToSunHours("알 수 없음")).toBeUndefined();
  });
});

describe("combineMid — 기온·육상 응답 합치기", () => {
  const ta = { taMin4: -3, taMax4: 5, taMin8: -8, taMax8: 1 };

  it("D+4~7은 오전/오후 강수확률 중 큰 값", () => {
    const w = combineMid(ta, { rnSt4Am: 20, rnSt4Pm: 60, wf4Am: "맑음", wf4Pm: "흐림" }, 4);
    expect(w).toMatchObject({ tempC: 5, tminC: -3, rainProbPct: 60 });
  });

  it("오전·오후 하늘상태가 다르면 일조가 적은 쪽 — 쾌적 판단은 보수적으로", () => {
    const w = combineMid(ta, { wf4Am: "맑음", wf4Pm: "흐림" }, 4);
    expect(w?.sunHours).toBe(1);
  });

  it("D+8~10은 일 단위 단일값을 쓴다", () => {
    const w = combineMid(ta, { rnSt8: 30, wf8: "구름많음" }, 8);
    expect(w).toMatchObject({ tempC: 1, tminC: -8, rainProbPct: 30, sunHours: 4 });
  });

  it("기온이 없으면 null — 중기예보 없음으로 보고 계절 모드로 폴백시킨다", () => {
    expect(combineMid({}, { rnSt4Am: 10 }, 4)).toBeNull();
  });

  it("강수확률·하늘상태가 없어도 기온만 있으면 성립 (TCI가 축 제외 후 재정규화)", () => {
    const w = combineMid(ta, {}, 4);
    expect(w).toEqual({ tempC: 5, tminC: -3 });
  });
});

describe("커버 범위", () => {
  it("D+4~D+10 — 단기예보(D+3)와 이어지고 겹치지 않는다", () => {
    expect(MID_MIN_OFFSET).toBe(4);
    expect(MID_MAX_OFFSET).toBe(10);
  });
});
