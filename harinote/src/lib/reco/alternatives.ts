/**
 * 안전 대체지 추천 v1 — 거리·카테고리·안전점수·실내외 적합도 기반 (제안서 핵심 기능)
 *
 * 규칙:
 * - 자기 자신 제외, Haversine 거리 30km 이내 (제안서: 강원 내 근거리 대체)
 * - 의미 있는 개선만: candidate.score >= target.score + RECO_MIN_SCORE_GAIN
 * - 카테고리 유사도(TourAPI 분류체계): cat3 일치 3점 > cat2 일치 2점 > contentTypeId 일치 1점
 * - 실내 보정: 악천후(weatherRisk >= 임계) 시 실내 후보 +2점
 * - 유형 관련성 0점(유사도 0 + 보정 0) 후보는 제외 — UI가 "같은 유형" 추천을 약속하므로
 * - 정렬: (유사도+보정) 내림차순 → 안전점수 내림차순 → 거리 오름차순
 */
import type { PlaceWithSafety } from "@/lib/datasource";
import {
  RECO_MIN_SCORE_GAIN,
  RECO_WEATHER_RISK_INDOOR_THRESHOLD,
} from "@/lib/safety/weights";
import { haversineKm } from "@/lib/reco/distance";

export interface Alternative extends PlaceWithSafety {
  distanceKm: number;
}

/** 대중교통 기준 후보 반경. 자차는 호출부에서 CAR_DISTANCE_KM 사용 */
export const MAX_DISTANCE_KM = 30;
/** 자차 이동 시 후보 반경 — 더 먼 대체지도 현실적 선택지 */
export const CAR_DISTANCE_KM = 50;
const INDOOR_BONUS = 2;
const DEFAULT_LIMIT = 4;

/** TourAPI 카테고리 유사도: cat3(소분류) > cat2(중분류) > contentTypeId(콘텐츠 유형) */
function categorySimilarity(
  target: PlaceWithSafety,
  candidate: PlaceWithSafety,
): number {
  if (target.cat3 && candidate.cat3 === target.cat3) return 3;
  if (target.cat2 && candidate.cat2 === target.cat2) return 2;
  if (candidate.contentTypeId === target.contentTypeId) return 1;
  return 0;
}

export function recommendAlternatives(
  target: PlaceWithSafety,
  candidates: PlaceWithSafety[],
  limit: number = DEFAULT_LIMIT,
  maxKm: number = MAX_DISTANCE_KM,
): Alternative[] {
  const preferIndoor =
    target.safety.weatherRisk >= RECO_WEATHER_RISK_INDOOR_THRESHOLD;

  const ranked: { alt: Alternative; rankScore: number }[] = [];
  for (const candidate of candidates) {
    if (candidate.contentId === target.contentId) continue;
    if (candidate.safety.score < target.safety.score + RECO_MIN_SCORE_GAIN)
      continue;

    const distanceKm = haversineKm(
      target.lat,
      target.lng,
      candidate.lat,
      candidate.lng,
    );
    if (distanceKm > maxKm) continue;

    let rankScore = categorySimilarity(target, candidate);
    if (preferIndoor && candidate.envType === "indoor") rankScore += INDOOR_BONUS;
    // 유형 관련성이 전혀 없는 후보는 제외 — "같은 유형의 대체지" 계약 유지
    if (rankScore === 0) continue;

    ranked.push({ alt: { ...candidate, distanceKm }, rankScore });
  }

  ranked.sort(
    (a, b) =>
      b.rankScore - a.rankScore ||
      b.alt.safety.score - a.alt.safety.score ||
      a.alt.distanceKm - b.alt.distanceKm,
  );

  return ranked.slice(0, limit).map((r) => r.alt);
}
