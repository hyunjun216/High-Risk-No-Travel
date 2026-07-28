import { describe, expect, it } from "vitest";
import { planSignature, topRiskFactors } from "@/lib/plan/diagnose";
import type { RiskBreakdown, RiskFactor } from "@/lib/safety/types";
import { EMPTY_PLAN, addItem, setTrip, type PlanItem } from "@/lib/travel-plan";

function factor(label: string, points: number): RiskFactor {
  return {
    key: "heat",
    label,
    value: 0,
    unit: "",
    threshold: 0,
    points,
    maxPoints: 40,
    level: points > 0 ? "moderate" : "low",
    description: label,
  };
}

function breakdown(factors: RiskFactor[]): RiskBreakdown {
  return {
    score: 80,
    grade: "moderate",
    profile: "default",
    factors,
    weatherRisk: 0,
    disasterRisk: 0,
    medicalRisk: 0,
  };
}

describe("topRiskFactors", () => {
  it("감점 있는 요인만 큰 순으로 상위 n개", () => {
    const b = breakdown([factor("강수", 5), factor("폭염", 20), factor("바람", 0)]);
    expect(topRiskFactors(b)).toEqual([
      { label: "폭염", points: 20 },
      { label: "강수", points: 5 },
    ]);
  });
  it("감점이 전혀 없으면 빈 배열", () => {
    expect(topRiskFactors(breakdown([factor("폭염", 0)]))).toEqual([]);
  });
});

describe("planSignature", () => {
  const A: PlanItem = { contentId: 1, title: "A", lat: 37, lng: 128 };
  const B: PlanItem = { contentId: 2, title: "B", lat: 38, lng: 128 };
  const p = addItem(addItem(EMPTY_PLAN, A), B);

  it("스톱 구성·출발일·프로필·이동수단이 같으면 동일", () => {
    expect(planSignature(p, "default", "transit")).toBe(
      planSignature({ ...p }, "default", "transit"),
    );
  });
  it("순서만 바뀌면 동일 (점수에 영향 없음)", () => {
    const swapped = { ...p, items: [p.items[1], p.items[0]] };
    expect(planSignature(swapped, "default", "transit")).toBe(
      planSignature(p, "default", "transit"),
    );
  });
  it("스톱·출발일·프로필·이동수단 변화는 서명을 바꾼다", () => {
    const base = planSignature(p, "default", "transit");
    expect(planSignature(addItem(p, { contentId: 3, title: "C", lat: 37, lng: 129 }), "default", "transit")).not.toBe(base);
    expect(planSignature(setTrip(p, 1, "2099-01-01"), "default", "transit")).not.toBe(base);
    expect(planSignature(p, "with_seniors", "transit")).not.toBe(base);
    expect(planSignature(p, "default", "car")).not.toBe(base);
  });
});
