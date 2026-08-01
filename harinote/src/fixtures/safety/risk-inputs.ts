/**
 * 위험 입력 mock — 1주차 fixture. 2주차에 기상청·AirKorea 실연동으로 교체.
 *
 * 계약: mockRiskInputFor(place, scenario?) — 같은 place에는 항상 같은 값(결정적).
 * - contentId 해시 기반 변주: 시드가 같으면 값도 같다 (스냅샷·SSR 안정성)
 * - scenario 미지정 시 contentId 해시로 4종(clear/heatwave/rainy/bad_air)을 고르게 배정
 *   → 리스트 화면에서 green/amber/red 등급이 골고루 보이도록 설계 (데모 다양성)
 * - envType별 가벼운 현실 보정: 산악·해안은 풍속↑, 산악은 응급실 거리↑
 */
import type { Place } from "@/lib/tour/types";
import type { RiskInput, ScenarioKey } from "@/lib/safety/types";

const SCENARIOS: ScenarioKey[] = ["clear", "heatwave", "rainy", "bad_air"];

/** 32bit 정수 해시 (lowbias32 변형) — 시드가 같으면 항상 같은 값 */
function hash32(seed: number): number {
  let x = (seed + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return (x ^ (x >>> 15)) >>> 0;
}

/** contentId + salt → [0, 1) 결정적 난수 */
function rand01(contentId: number, salt: number): number {
  return hash32((Math.imul(contentId, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0) / 0x1_0000_0000;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function pickScenario(contentId: number): ScenarioKey {
  return SCENARIOS[hash32(contentId) % SCENARIOS.length];
}

export function mockRiskInputFor(
  place: Pick<Place, "contentId" | "envType">,
  scenario?: ScenarioKey,
): RiskInput {
  const { contentId, envType } = place;
  const s = scenario ?? pickScenario(contentId);
  const r = (salt: number) => rand01(contentId, salt);

  let input: RiskInput;
  switch (s) {
    case "clear":
      input = {
        tempC: round1(23 + r(1) * 4), // 23~27℃
        rainProbPct: Math.round(r(2) * 20), // 0~20%
        windMs: round1(1 + r(3) * 3), // 1~4m/s
        pm25: Math.round(5 + r(4) * 10), // 좋음(≤15)
        forestFireLevel: 1,
        emergencyRoomKm: round1(3 + r(5) * 7), // 3~10km
      };
      break;
    case "heatwave": {
      // 심각도 상관 부여: 심할수록 기온·산불단계·응급실 거리 동시 상승 (red 등급 재현용)
      const sev = r(6);
      input = {
        tempC: round1(34 + sev * 2), // 34~36℃ (폭염주의보~경보)
        rainProbPct: Math.round(r(2) * 20),
        windMs: round1(1 + r(3) * 3),
        pm25: Math.round(20 + sev * 35), // 20~55
        forestFireLevel: sev > 0.75 ? 4 : sev > 0.4 ? 3 : 2,
        emergencyRoomKm: round1(4 + sev * 30), // 4~34km
      };
      break;
    }
    case "rainy": {
      const sev = r(7);
      input = {
        tempC: round1(24 + r(1) * 4),
        rainProbPct: Math.round(70 + sev * 20), // 70~90%
        rainMm: Math.round(20 + sev * 60), // 20~80mm (호우주의보 근접)
        windMs: round1(5 + sev * 9), // 5~14m/s
        pm25: Math.round(5 + r(4) * 15),
        forestFireLevel: 1,
        emergencyRoomKm: round1(4 + r(5) * 16),
      };
      break;
    }
    case "bad_air":
      input = {
        tempC: round1(26 + r(1) * 5),
        rainProbPct: Math.round(r(2) * 20),
        windMs: round1(1 + r(3) * 2),
        pm25: Math.round(60 + r(8) * 30), // 60~90 (나쁨~매우나쁨)
        forestFireLevel: r(9) > 0.5 ? 2 : 1,
        emergencyRoomKm: round1(4 + r(5) * 20),
      };
      break;
  }

  // envType별 가벼운 현실 보정
  if (envType === "outdoor_mountain") {
    if (input.windMs !== undefined) input.windMs = round1(input.windMs + 2); // 산악 능선 풍속↑
    input.emergencyRoomKm = round1(input.emergencyRoomKm + 4); // 산간 접근성↓
  } else if (envType === "outdoor_coast") {
    if (input.windMs !== undefined) input.windMs = round1(input.windMs + 3); // 해안 해풍↑
  }

  // 한계: 습도(REH)를 생성하지 않아 체감온도(apparentTempC) 미설정 — 폭염은 건구 최고기온으로 평가

  // 대피소(shelterKm)는 mock으로 생성하지 않는다 — live 경로(risk/live.ts)가
  // 내장 대피시설 좌표(src/data/shelters.gangwon.json)로 항상 실계산해 덮어쓴다
  // (응급의료 거리와 달리 mock 베이스라인조차 불필요 — 네트워크·키 무관 실값).

  return input;
}
