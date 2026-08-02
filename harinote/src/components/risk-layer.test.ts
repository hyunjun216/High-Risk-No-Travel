import { describe, expect, it } from "vitest";
import { layerTotals } from "@/components/risk-layer";
import { computeSafetyScore } from "@/lib/safety/score";
import type { RiskFactor, RiskFactorKey, RiskInput } from "@/lib/safety/types";

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
      f("forest_fire", 15), f("medical", 4), f("shelter", 3), // 안전 22
    ]);
    expect(totals.comfort).toBe(21);
    expect(totals.safety).toBe(22);
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
      pm25: 55, forestFireLevel: 2, emergencyRoomKm: 22, shelterKm: 4,
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
