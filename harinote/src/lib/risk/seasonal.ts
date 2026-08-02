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
import {
  COLD,
  ENV_WEIGHT,
  coldPoints,
  gradeForScore,
  levelForPoints,
} from "@/lib/safety/weights";
import { nearestHospitalKm } from "./medical";
import { nearestShelterKm } from "./shelter";

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

// 한파 곡선·임계값은 weights.ts COLD/coldPoints에 있다 (기상청 한파특보 기준).
// 여기서는 계절 모드 점수에 후처리로 얹는 일만 한다.
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

/** 한파 감점을 breakdown에 반영 — score 차감 + weather 소계 + cold 요인 추가 */
function applyCold(br: RiskBreakdown, tminC: number, envType: Place["envType"]): RiskBreakdown {
  // 추위도 열 축이므로 환경유형의 heat 가중을 그대로 쓴다 (실내 0.3, 야외 1.0)
  const pts = Math.round(coldPoints(tminC) * ENV_WEIGHT[envType].heat);
  if (pts <= 0) return br;
  const score = Math.max(0, br.score - pts);
  const tmin = Math.round(tminC * 10) / 10;
  return {
    ...br,
    score,
    grade: gradeForScore(score),
    weatherRisk: br.weatherRisk + pts,
    factors: [
      ...br.factors,
      {
        key: "cold",
        label: "한파",
        value: tmin,
        unit: "℃",
        threshold: COLD.ADVISORY_C,
        points: pts,
        maxPoints: COLD.MAX_POINTS,
        level: levelForPoints(pts, COLD.MAX_POINTS),
        description: `이 시기 최저기온 ${tmin}℃ — 한파주의보 기준(−12℃) ${tmin <= COLD.ADVISORY_C ? "이하" : "미만 접근"}`,
      },
    ],
  };
}

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

  // 대피소 거리 — live 경로와 동일하게 내장 좌표 실계산 (데이터 없으면 축 비활성)
  const shRaw = nearestShelterKm(place.lat, place.lng, place.contentId);
  const shelterKm = Number.isFinite(shRaw) ? Math.round(shRaw * 10) / 10 : undefined;

  const common = {
    pm25: SEASONAL_PM25,
    forestFireLevel: FIRE_BY_MONTH[month],
    emergencyRoomKm,
    ...(shelterKm !== undefined ? { shelterKm } : {}),
  };
  const typicalInput: RiskInput = {
    tempC: s.tmaxMed + dz,
    rainProbPct: s.wetdayPct,
    windMs: s.windMed,
    ...common,
  };
  const badInput: RiskInput = {
    tempC: s.tmaxP90 + dz,
    rainProbPct: 85,
    rainMm: s.precipP90,
    windMs: s.windP90,
    ...common,
  };

  return {
    month,
    typical: applyCold(
      computeSafetyScore(typicalInput, place, profile),
      s.tminMed + dz,
      place.envType,
    ),
    bad: applyCold(
      computeSafetyScore(badInput, place, profile),
      s.tminP10 + dz,
      place.envType,
    ),
  };
}
