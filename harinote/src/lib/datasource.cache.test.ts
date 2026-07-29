/**
 * riskInput 캐시 회귀 테스트 — 캐시는 profile 무관 1벌이어야 한다.
 * profile이 캐시 키였던 시절, 동행 칩 전환마다 전량 riskInput 재수집
 * (콜드 시 KMA 격자 수백 페치, ~20초)이 일어나 목록 화면이 멈췄다.
 */
import { describe, expect, it, vi } from "vitest";
import type { Place } from "@/lib/tour/types";

vi.mock("@/lib/risk/live", async () => {
  const { mockRiskInputFor } = await vi.importActual<
    typeof import("@/fixtures/safety/risk-inputs")
  >("@/fixtures/safety/risk-inputs");
  return {
    hasLiveRiskKeys: () => false,
    getLiveRiskInput: vi.fn(
      async (place: Pick<Place, "contentId" | "envType">) =>
        mockRiskInputFor(place),
    ),
    getForecastRiskInput: vi.fn(async () => null),
  };
});

process.env.DATA_SOURCE = "mock";

import { getLiveRiskInput } from "@/lib/risk/live";
import { getPlacesWithSafety } from "@/lib/datasource";

describe("getPlacesWithSafety — riskInput 캐시는 profile 무관", () => {
  it("profile 전환이 riskInput 재수집을 유발하지 않는다", async () => {
    const first = await getPlacesWithSafety(undefined, "default");
    expect(first.length).toBeGreaterThan(0);
    const callsAfterFirst = vi.mocked(getLiveRiskInput).mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = await getPlacesWithSafety(undefined, "with_kids");
    expect(second.length).toBe(first.length);
    expect(vi.mocked(getLiveRiskInput).mock.calls.length).toBe(callsAfterFirst);
  });

  it("점수는 요청한 profile 기준으로 각각 계산된다", async () => {
    const base = await getPlacesWithSafety(undefined, "default");
    const kids = await getPlacesWithSafety(undefined, "with_kids");
    expect(base.every((p) => p.safety.profile === "default")).toBe(true);
    expect(kids.every((p) => p.safety.profile === "with_kids")).toBe(true);
  });
});
