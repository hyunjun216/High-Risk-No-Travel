/**
 * mock 위험 입력 테스트 — 결정성(같은 입력 → 같은 값)과 시나리오 분포 확인.
 */
import { describe, expect, it } from "vitest";
import { mockRiskInputFor } from "@/fixtures/safety/risk-inputs";
import { computeSafetyScore } from "@/lib/safety/score";
import type { ScenarioKey } from "@/lib/safety/types";
import type { PlaceEnvType } from "@/lib/tour/types";

const ENV_TYPES: PlaceEnvType[] = [
  "indoor",
  "outdoor_water",
  "outdoor_mountain",
  "outdoor_coast",
  "outdoor_general",
];

function place(contentId: number, envType: PlaceEnvType = "outdoor_general") {
  return { contentId, envType };
}

describe("mockRiskInputFor — 결정성", () => {
  it("같은 contentId로 2회 호출하면 항상 동일한 값", () => {
    for (const id of [1, 42, 126508, 2733967]) {
      for (const env of ENV_TYPES) {
        expect(mockRiskInputFor(place(id, env))).toEqual(
          mockRiskInputFor(place(id, env)),
        );
      }
    }
  });

  it("시나리오 지정 시에도 결정적", () => {
    const scenarios: ScenarioKey[] = ["clear", "heatwave", "rainy", "bad_air"];
    for (const s of scenarios) {
      expect(mockRiskInputFor(place(77), s)).toEqual(mockRiskInputFor(place(77), s));
    }
  });
});

describe("mockRiskInputFor — 시나리오 값 범위", () => {
  const ids = Array.from({ length: 40 }, (_, i) => i * 137 + 1);

  it("clear: 폭염·호우·고농도 미세먼지 없음", () => {
    for (const id of ids) {
      const r = mockRiskInputFor(place(id), "clear");
      expect(r.tempC).toBeLessThan(33);
      expect(r.rainProbPct).toBeLessThan(30);
      expect(r.pm25).toBeLessThanOrEqual(15);
      expect(r.forestFireLevel).toBe(1);
    }
  });

  it("heatwave: 최고기온 34~36℃", () => {
    for (const id of ids) {
      const r = mockRiskInputFor(place(id), "heatwave");
      expect(r.tempC).toBeGreaterThanOrEqual(34);
      expect(r.tempC).toBeLessThanOrEqual(36);
    }
  });

  it("rainy: 강수확률 70~90%, 강수량 존재", () => {
    for (const id of ids) {
      const r = mockRiskInputFor(place(id), "rainy");
      expect(r.rainProbPct).toBeGreaterThanOrEqual(70);
      expect(r.rainProbPct).toBeLessThanOrEqual(90);
      expect(r.rainMm ?? 0).toBeGreaterThan(0);
    }
  });

  it("bad_air: PM2.5 60~90", () => {
    for (const id of ids) {
      const r = mockRiskInputFor(place(id), "bad_air");
      expect(r.pm25).toBeGreaterThanOrEqual(60);
      expect(r.pm25).toBeLessThanOrEqual(90);
    }
  });

  it("공통: 값이 유효 범위(RiskInput 계약) 안", () => {
    for (const id of ids) {
      for (const env of ENV_TYPES) {
        const r = mockRiskInputFor(place(id, env));
        expect(r.rainProbPct).toBeGreaterThanOrEqual(0);
        expect(r.rainProbPct).toBeLessThanOrEqual(100);
        expect(r.windMs).toBeGreaterThanOrEqual(0);
        expect(r.pm25).toBeGreaterThanOrEqual(0);
        expect([1, 2, 3, 4]).toContain(r.forestFireLevel);
        expect(r.emergencyRoomKm).toBeGreaterThan(0);
        expect(r.shelterKm).toBeUndefined(); // 대피소 축 비활성 (실데이터 확보 전)
      }
    }
  });
});

describe("mockRiskInputFor — 분포/보정", () => {
  it("scenario 미지정 시 contentId 해시로 4종이 고르게 배정(각 15% 이상)", () => {
    const counts = { clear: 0, heatwave: 0, rainy: 0, bad_air: 0 };
    for (let id = 1; id <= 200; id++) {
      const r = mockRiskInputFor(place(id));
      if (r.tempC >= 34) counts.heatwave++;
      else if (r.rainProbPct >= 70) counts.rainy++;
      else if (r.pm25 >= 60) counts.bad_air++;
      else counts.clear++;
    }
    for (const n of Object.values(counts)) {
      expect(n).toBeGreaterThanOrEqual(30); // 200건 중 15%
    }
  });

  it("envType 보정: 산악/해안은 같은 contentId의 일반 야외보다 풍속이 높다", () => {
    for (const id of [3, 55, 910]) {
      const general = mockRiskInputFor(place(id, "outdoor_general"));
      const mountain = mockRiskInputFor(place(id, "outdoor_mountain"));
      const coast = mockRiskInputFor(place(id, "outdoor_coast"));
      // mock은 windMs를 항상 채운다 (중기예보 경로만 미설정 — RiskInput.windMs 주석 참조)
      expect(general.windMs).toBeDefined();
      expect(mountain.windMs!).toBeGreaterThan(general.windMs!);
      expect(coast.windMs!).toBeGreaterThan(general.windMs!);
    }
  });

  it("데모 다양성: 점수 엔진과 결합 시 green/amber/red 등급이 모두 등장", () => {
    const grades = new Set<string>();
    for (let id = 1; id <= 200; id++) {
      const env = ENV_TYPES[id % ENV_TYPES.length];
      const b = computeSafetyScore(
        mockRiskInputFor(place(id, env)),
        { envType: env },
      );
      grades.add(b.grade);
    }
    expect(grades).toContain("low");
    expect(grades).toContain("moderate");
    expect(grades).toContain("high");
  });
});
