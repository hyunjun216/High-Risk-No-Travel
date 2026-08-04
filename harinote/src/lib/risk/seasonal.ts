/**
 * 계절 모드 — 30년(1991~2020) 기후 분위수 시나리오로 먼 날짜(D+4~)의 점수 "범위" 계산.
 *
 * 개별 날짜의 날씨는 예보할 수 없으므로 단일 점수를 단정하지 않고,
 * 그 달의 "통상일(중앙값) / 궂은날(나쁜 쪽 90분위)" 두 시나리오를
 * 기존 점수 엔진(computeSafetyScore)에 그대로 입력해 범위를 만든다.
 *
 * 분석 원본: analysis/16b_seasonal_scenarios.py seasonal_range() — 산식·상수 동일 포팅.
 * 데이터: src/data/seasonal-scenarios.json (18시군×12월), src/data/elevations.json (표고 775곳).
 * 서버 전용 모듈.
 */
import scenariosJson from "@/data/seasonal-scenarios.json";
import elevationsJson from "@/data/elevations.json";
import type { Place } from "@/lib/tour/types";
import type { Profile, RiskBreakdown, RiskInput } from "@/lib/safety/types";
import { computeSafetyScore } from "@/lib/safety/score";
import { coldPoints } from "@/lib/safety/weights";
import { nearestHospitalKm } from "./medical";

/** 기온감률 ℃/m — 시군 대표점과 관광지의 표고 차 보정 */
const LAPSE = 0.0065;

/** 산림청 산불조심기간 달력: 봄(2~4월) 3단계, 5·11·12월 2단계, 그 외 1단계 */
const FIRE_BY_MONTH: Record<number, 1 | 2 | 3 | 4> = {
  1: 1, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 11: 2, 12: 2,
};

/** 계절 모드의 미세먼지 고정값 — 월별 예보 불가, 연평균 "보통" 수준 */
const SEASONAL_PM25 = 25;

// 한계: 습도 평년값이 없어 체감온도(apparentTempC) 미설정 — 폭염은 건구 최고기온으로 평가

interface SeasonalScenario {
  seatElev: number;
  tmaxMed: number;
  tminMed: number;
  windMed: number;
  wetdayPct: number;
  tmaxP90: number;
  tminP10: number;
  precipP90: number;
  windP90: number;
}

const SCENARIOS = scenariosJson as Record<string, Record<string, SeasonalScenario>>;
const ELEVATIONS = elevationsJson as Record<string, number>;

// 한파 곡선·임계값은 weights.ts COLD/coldPoints에 있고, 감점은 점수 엔진(score.ts)이
// RiskInput.tminC로 계산한다 — 계절 모드는 시나리오의 최저기온을 입력으로 넘길 뿐이다.
// (후처리로 얹던 구조는 예보 경로가 축을 통째로 빠뜨리는 원인이었다)
export { coldPoints };

export interface SeasonalRange {
  month: number;
  /** 통상일(중앙값 시나리오) 점수 */
  typical: RiskBreakdown;
  /** 궂은날(90분위 시나리오) 점수 — 주의 요인 안내는 이쪽 기준 */
  bad: RiskBreakdown;
}

type SeasonalPlace = Pick<
  Place,
  "contentId" | "envType" | "sigunguCode" | "lat" | "lng"
>;

/**
 * 관광지 + 월 → 통상일/궂은날 점수 범위. 시나리오 데이터가 없는 시군이면 null.
 * 표고 보정: 관광지 표고를 알면 시군 대표점과의 차이에 기온감률 적용 (모르면 0).
 */
export function seasonalRange(
  place: SeasonalPlace,
  month: number,
  profile: Profile = "default",
): SeasonalRange | null {
  const s = SCENARIOS[String(place.sigunguCode)]?.[String(month)];
  if (!s) return null;

  const elev = ELEVATIONS[String(place.contentId)];
  const dz = elev !== undefined ? -LAPSE * (elev - s.seatElev) : 0;

  const erRaw = nearestHospitalKm(place.lat, place.lng, place.contentId);
  const emergencyRoomKm = Number.isFinite(erRaw) ? Math.round(erRaw * 10) / 10 : 10;

  const common = {
    pm25: SEASONAL_PM25,
    forestFireLevel: FIRE_BY_MONTH[month],
    emergencyRoomKm,
  };
  // 최저기온(tminC)은 점수 엔진의 한파 축 입력이다 — 통상일은 중앙값, 궂은날은 하위 10분위
  const typicalInput: RiskInput = {
    tempC: s.tmaxMed + dz,
    tminC: s.tminMed + dz,
    rainProbPct: s.wetdayPct,
    windMs: s.windMed,
    ...common,
  };
  const badInput: RiskInput = {
    tempC: s.tmaxP90 + dz,
    tminC: s.tminP10 + dz,
    rainProbPct: 85,
    rainMm: s.precipP90,
    windMs: s.windP90,
    ...common,
  };

  return {
    month,
    typical: computeSafetyScore(typicalInput, place, profile),
    bad: computeSafetyScore(badInput, place, profile),
  };
}
