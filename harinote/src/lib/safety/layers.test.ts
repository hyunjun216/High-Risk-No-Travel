import { describe, expect, it } from "vitest";
import { layerTotals, meetsCourseSafety } from "@/lib/safety/layers";
import { computeSafetyScore } from "@/lib/safety/score";
import type { RiskFactor, RiskFactorKey, RiskInput } from "@/lib/safety/types";
import type { PlaceEnvType } from "@/lib/tour/types";
import { COURSE_MIN_STOP_SCORE } from "@/lib/safety/weights";

function f(key: RiskFactorKey, points: number): RiskFactor {
  return {
    key,
    label: key,
    value: 0,
    unit: "",
    threshold: 0,
    points,
    maxPoints: 40,
    level: "low",
    description: "",
  };
}

describe("layerTotals — 쾌적/안전 층 분리", () => {
  it("관광기후지수 축은 쾌적, 재난·의료는 안전", () => {
    const totals = layerTotals([
      f("heat", 10), f("rain", 5), f("wind", 2), f("pm", 3), f("sun", 1), // 쾌적 21
      f("forest_fire", 15), f("medical", 4), // 안전 19
    ]);
    expect(totals.comfort).toBe(21);
    expect(totals.safety).toBe(19);
  });

  it("한파는 안전층 — 기상 현상이지만 기준이 한파특보(위험)다", () => {
    expect(layerTotals([f("cold", 12)])).toEqual({ comfort: 0, safety: 12 });
  });

  it("호우는 안전층 — 같은 비여도 쾌적(rain)과 침수·급류(heavy_rain)는 다른 축", () => {
    const totals = layerTotals([f("rain", 8), f("heavy_rain", 11)]);
    expect(totals.comfort).toBe(8);
    expect(totals.safety).toBe(11);
  });

  it("분류에 없는 키는 안전층으로 — 새 위험 축이 조용히 빠지지 않게", () => {
    expect(layerTotals([f("landslide", 45)])).toEqual({ comfort: 0, safety: 45 });
  });

  it("두 층의 합 = 전체 감점 합 (엔진 실제 출력으로 확인)", () => {
    const input: RiskInput = {
      tempC: -2, tminC: -13, rainProbPct: 70, rainMm: 40, windMs: 8, sunHours: 3,
      pm25: 55, forestFireLevel: 2, emergencyRoomKm: 22,
    };
    const b = computeSafetyScore(input, { envType: "outdoor_mountain" }, "with_kids");
    const totals = layerTotals(b.factors);
    const all = b.factors.reduce((s, x) => s + x.points, 0);
    expect(totals.comfort + totals.safety).toBe(all);
    // 어느 한쪽으로 쏠려 분류가 사실상 무의미해지지 않는지
    expect(totals.comfort).toBeGreaterThan(0);
    expect(totals.safety).toBeGreaterThan(0);
  });
});

describe("meetsCourseSafety — 코스 스톱 자격은 안전층만 본다", () => {
  /** 야외 관광지 기준 입력 — 필요한 축만 바꿔 쓴다 */
  const at = (over: Partial<RiskInput>, envType: PlaceEnvType = "outdoor_general") =>
    computeSafetyScore(
      {
        tempC: 20, rainProbPct: 0, pm25: 12, windMs: 2, sunHours: 9,
        forestFireLevel: 1, emergencyRoomKm: 5,
        ...over,
      },
      { envType },
      "default",
    );

  it("추워서 총점이 낮은 곳은 통과한다 — 겨울 코스가 전멸하던 원인", () => {
    const winter = at({ tempC: -8, tminC: -15 });
    // 총점만 보면 컷(60) 아래로 떨어지는데, 감점의 대부분이 쾌적(추위)이다
    expect(winter.score).toBeLessThan(COURSE_MIN_STOP_SCORE);
    const t = layerTotals(winter.factors);
    expect(t.comfort).toBeGreaterThan(t.safety);
    expect(meetsCourseSafety(winter)).toBe(true);
  });

  it("총점이 같아도 감점 출처가 다르면 자격이 갈린다", () => {
    // 같은 '주의 요인 있음'이라도 추위 때문인 곳은 코스에 들어가고, 산불 때문인 곳은 빠진다
    const cold = at({ tempC: -8, tminC: -15 });
    const fire = at({ forestFireLevel: 3 });
    expect(meetsCourseSafety(cold)).toBe(true);
    expect(meetsCourseSafety(fire)).toBe(false);
  });

  it("비가 많이 와 불편한 곳도 통과 — 침수·급류가 아니면 안전 문제가 아니다", () => {
    const rainy = at({ rainProbPct: 95, sunHours: 1 });
    expect(meetsCourseSafety(rainy)).toBe(true);
  });

  it("산불 3단계 야외는 제외된다 — 제외 사유는 위험이어야 한다", () => {
    expect(meetsCourseSafety(at({ forestFireLevel: 3 }))).toBe(false);
    expect(meetsCourseSafety(at({ forestFireLevel: 4 }))).toBe(false);
  });

  it("산불 3단계여도 실내는 통과 — 환경유형 할인이 안전층에 그대로 반영된다", () => {
    expect(meetsCourseSafety(at({ forestFireLevel: 3 }, "indoor"))).toBe(true);
  });

  it("산사태 경보·주의보는 제외", () => {
    expect(meetsCourseSafety(at({ landslideLevel: 1 }))).toBe(false);
    expect(meetsCourseSafety(at({ landslideLevel: 2 }))).toBe(false);
  });

  it("임계값은 COURSE_MIN_STOP_SCORE를 그대로 쓴다 — 새 설계값을 만들지 않았다", () => {
    // 안전 감점이 (100 − 60) = 40을 넘는 순간 탈락한다
    const b = at({ forestFireLevel: 3 });
    expect(layerTotals(b.factors).safety).toBeGreaterThan(100 - COURSE_MIN_STOP_SCORE);
  });
});
