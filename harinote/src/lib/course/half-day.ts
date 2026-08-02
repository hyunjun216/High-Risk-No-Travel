/**
 * 안전 반나절 코스 자동 생성 — 제안서 핵심 기능 ③ 후반부.
 * "안전 점수 높은 관광지 + 음식점 + 실내시설을 묶은 반나절 코스"
 *
 * 규칙:
 * - 앵커: target이 "주의 요인 높음"이거나, "주의 요인 있음"이면서 대체지 1순위가
 *   +10점 이상 개선이면 대체지 1순위로 전환 (제안서: 위험 시 실내 문화시설 중심 코스 전환)
 * - 오전 = 앵커, 점심 = 앵커 반경 10km 내 음식점 중 안전점수 최고(동점이면 근거리),
 *   오후 = 직전 스톱 반경 15km 내 관광지·문화시설 중 안전점수 최고
 *   (앵커 기상 감점이 크면 실내 우선, 앵커와 같은 소분류(cat3)면 소폭 가점)
 * - 모든 스톱은 안전점수 60점 이상만 — 주의 요인 높은 곳을 코스에 넣지 않는다
 * - 채워진 슬롯이 2개 미만이면 null (UI가 섹션을 숨긴다)
 */
import type { PlaceWithSafety } from "@/lib/datasource";
import type { Alternative } from "@/lib/reco/alternatives";
import { CAT3_CAFE } from "@/lib/tour/types";
import {
  COURSE_ANCHOR_SWITCH_MIN_GAIN,
  RECO_WEATHER_RISK_INDOOR_THRESHOLD,
} from "@/lib/safety/weights";
import { meetsCourseSafety } from "@/lib/safety/layers";
import { haversineKm } from "@/lib/reco/distance";

export interface CourseStop {
  slot: "morning" | "lunch" | "afternoon";
  place: PlaceWithSafety;
  /** 이전 스톱에서의 이동 거리 (첫 스톱은 undefined) */
  legKm?: number;
}

export interface HalfDayCourse {
  stops: CourseStop[]; // 오전 → 점심 → 오후 순
  totalKm: number; // 이동 거리 합
  /** 코스 기준점이 대체지인지 (target이 위험해 대체지 중심으로 짰는지) */
  anchoredOnAlternative: boolean;
}

/** 점심(음식점) 탐색 반경 */
const LUNCH_RADIUS_KM = 10;
/** 오후 스톱 탐색 반경 (직전 스톱 기준) */
const AFTERNOON_RADIUS_KM = 15;
/** 앵커와 같은 소분류(cat3) 오후 후보 가점 — 취향 일관성 소폭 우대 */
const SAME_CAT3_BONUS = 3;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * 대체지 중심 코스로 전환해야 하는가 — 코스 본체 없이 배너 문구만 필요한
 * 화면(체크 리포트)이 전량 코스 계산 없이 재사용할 수 있게 분리 export.
 */
export function shouldAnchorOnAlternative(
  target: PlaceWithSafety,
  alternatives: Alternative[],
): boolean {
  const top = alternatives[0];
  return (
    top !== undefined &&
    (target.safety.grade === "high" ||
      (target.safety.grade === "moderate" &&
        top.safety.score >= target.safety.score + COURSE_ANCHOR_SWITCH_MIN_GAIN))
  );
}

/** 앵커 결정: 위험한 target이면 대체지 1순위 중심으로 코스를 전환한다 */
function pickAnchor(
  target: PlaceWithSafety,
  alternatives: Alternative[],
): { anchor: PlaceWithSafety; anchoredOnAlternative: boolean } {
  return shouldAnchorOnAlternative(target, alternatives)
    ? { anchor: alternatives[0], anchoredOnAlternative: true }
    : { anchor: target, anchoredOnAlternative: false };
}

/** 점심: 앵커 반경 10km 내 음식점 중 안전점수 최고 (동점이면 가까운 곳) */
function pickLunch(
  anchor: PlaceWithSafety,
  candidates: PlaceWithSafety[],
  excludeIds: Set<number>,
  radiusScale = 1,
): PlaceWithSafety | null {
  let best: PlaceWithSafety | null = null;
  let bestKm = Infinity;
  for (const c of candidates) {
    if (c.contentTypeId !== 39) continue;
    // 점심 슬롯은 식사 목적 — 카페/전통찻집(A05020900)은 제외
    if (c.cat3 === CAT3_CAFE) continue;
    if (excludeIds.has(c.contentId)) continue;
    if (!meetsCourseSafety(c.safety)) continue;
    const km = haversineKm(anchor.lat, anchor.lng, c.lat, c.lng);
    if (km > LUNCH_RADIUS_KM * radiusScale) continue;
    if (
      best === null ||
      c.safety.score > best.safety.score ||
      (c.safety.score === best.safety.score && km < bestKm)
    ) {
      best = c;
      bestKm = km;
    }
  }
  return best;
}

/**
 * 오후: 직전 스톱 반경 15km 내 관광지(12)·문화시설(14).
 * 악천후(앵커 weatherRisk >= 임계)면 실내 우선, 같은 cat3면 소폭 가점,
 * 그 외에는 안전점수 최고 (동점이면 가까운 곳).
 */
function pickAfternoon(
  anchor: PlaceWithSafety,
  from: PlaceWithSafety,
  candidates: PlaceWithSafety[],
  excludeIds: Set<number>,
  radiusScale = 1,
): PlaceWithSafety | null {
  const preferIndoor =
    anchor.safety.weatherRisk >= RECO_WEATHER_RISK_INDOOR_THRESHOLD;

  let best: PlaceWithSafety | null = null;
  let bestKey: [number, number, number] = [-1, -1, Infinity];
  for (const c of candidates) {
    if (c.contentTypeId !== 12 && c.contentTypeId !== 14) continue;
    if (excludeIds.has(c.contentId)) continue;
    if (!meetsCourseSafety(c.safety)) continue;
    const km = haversineKm(from.lat, from.lng, c.lat, c.lng);
    if (km > AFTERNOON_RADIUS_KM * radiusScale) continue;

    const indoorRank = preferIndoor && c.envType === "indoor" ? 1 : 0;
    const rankScore =
      c.safety.score +
      (anchor.cat3 && c.cat3 === anchor.cat3 ? SAME_CAT3_BONUS : 0);
    // 정렬 키: 실내 우선 → 점수(가점 포함) 내림차순 → 거리 오름차순
    if (
      indoorRank > bestKey[0] ||
      (indoorRank === bestKey[0] &&
        (rankScore > bestKey[1] ||
          (rankScore === bestKey[1] && km < bestKey[2])))
    ) {
      best = c;
      bestKey = [indoorRank, rankScore, km];
    }
  }
  return best;
}

export function buildHalfDayCourse(
  target: PlaceWithSafety,
  alternatives: Alternative[],
  candidates: PlaceWithSafety[],
  /** 이동수단별 반경 배율 — 자차 1.5 (점심 15km, 오후 22.5km) */
  radiusScale = 1,
): HalfDayCourse | null {
  const { anchor, anchoredOnAlternative } = pickAnchor(target, alternatives);

  // 앵커 자체가 60점 미만이면 코스 기준점이 없다 — 코스 생성 불가
  if (!meetsCourseSafety(anchor.safety)) return null;

  // 앵커·target은 다른 슬롯에 재등장 금지 (대체지 전환 시 위험한 target 재추천 방지)
  const excludeIds = new Set([anchor.contentId, target.contentId]);

  const lunch = pickLunch(anchor, candidates, excludeIds, radiusScale);
  const afternoon = pickAfternoon(
    anchor,
    lunch ?? anchor, // 점심이 없으면 앵커 기준 15km
    candidates,
    excludeIds,
    radiusScale,
  );

  const places: { slot: CourseStop["slot"]; place: PlaceWithSafety }[] = [
    { slot: "morning" as const, place: anchor },
    ...(lunch ? [{ slot: "lunch" as const, place: lunch }] : []),
    ...(afternoon ? [{ slot: "afternoon" as const, place: afternoon }] : []),
  ];
  if (places.length < 2) return null;

  let totalKm = 0;
  const stops: CourseStop[] = places.map(({ slot, place }, i) => {
    if (i === 0) return { slot, place };
    const prev = places[i - 1].place;
    const legKm = round1(haversineKm(prev.lat, prev.lng, place.lat, place.lng));
    totalKm += legKm;
    return { slot, place, legKm };
  });

  return { stops, totalKm: round1(totalKm), anchoredOnAlternative };
}
