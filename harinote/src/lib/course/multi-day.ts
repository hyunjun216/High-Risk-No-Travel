/**
 * N박 전체 코스 빌더 — 플래너의 박수·출발일에 맞춰 일차별
 * (오전 → 점심 → 오후) 스톱과 밤 숙소(마지막 일차 제외)를 구성한다.
 *
 * 규칙 (themed.ts의 슬롯 규칙을 다일차로 확장):
 * - 1일차 오전: 시군 내 테마 매칭 중 최고점 (관광 매력도 우대 포함)
 * - 2일차+ 오전: 전날 숙소(없으면 마지막 스톱) 반경 25km 내 테마 매칭,
 *   반경 내가 없으면 시군 전체로 폴백 — 그래도 없으면 그 일차에서 중단
 * - 점심 10km 음식점(카페 제외) / 오후 15km 관광지·문화시설 — themed.ts와 동일
 * - 숙소: 그날 마지막 스톱 반경 15km 내 안전점수 60 이상, 최근접 5곳 중
 *   (안전점수 + 사진 우대) 최고 — 전 일차에서 쓴 곳은 제외
 * - 모든 스톱은 해당 "일차 날짜 기준" 점수의 후보 목록에서 뽑는다 (호출부 책임)
 */
import type { PlaceWithSafety } from "@/lib/datasource";
import { CAT3_CAFE } from "@/lib/tour/types";
import {
  COURSE_MIN_STOP_SCORE,
  RECO_WEATHER_RISK_INDOOR_THRESHOLD,
} from "@/lib/safety/weights";
import { haversineKm } from "@/lib/reco/distance";
import {
  AFTERNOON_RADIUS_KM,
  attractionBonus,
  LUNCH_RADIUS_KM,
  matchesTheme,
  selectTopCandidates,
  type CourseSlot,
  type CourseTheme,
} from "@/lib/course/themed";

/** 2일차+ 오전 앵커 탐색 반경 (전날 숙소 기준) */
const NEXT_ANCHOR_RADIUS_KM = 25;
/** 숙소 탐색 반경 (그날 마지막 스톱 기준) */
const LODGING_RADIUS_KM = 15;
/** 숙소는 최근접 N곳 중에서 점수·사진으로 고른다 */
const LODGING_NEAREST_POOL = 5;

export interface MultiDayStop {
  slot: CourseSlot;
  place: PlaceWithSafety;
}

export interface MultiDayDay {
  /** 1-based 일차 */
  day: number;
  stops: MultiDayStop[];
  /** 마지막 일차는 없음 */
  lodging?: { place: PlaceWithSafety; distanceKm: number };
  /** 스톱(+숙소) 직선 이동거리 합 */
  totalKm: number;
}

export interface MultiDayCourse {
  theme: CourseTheme;
  days: MultiDayDay[];
  totalKm: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * @param candidatesByDay 일차별(그 날짜 기준 점수) 관광지 후보 — 길이 = 총 일수
 * @param lodgingsByDay   일차별 점수 계산된 숙박(32) 후보 — 마지막 일차는 사용 안 함
 */
export function buildMultiDayCourse(
  theme: CourseTheme,
  sigunguCode: number,
  candidatesByDay: PlaceWithSafety[][],
  lodgingsByDay: PlaceWithSafety[][],
): MultiDayCourse | null {
  const dayCount = candidatesByDay.length;
  if (dayCount === 0) return null;
  const used = new Set<number>();
  const days: MultiDayDay[] = [];
  let prevNight: PlaceWithSafety | null = null;

  for (let d = 0; d < dayCount; d++) {
    const all = candidatesByDay[d];

    // ── 오전 앵커 ──
    const anchorNear = prevNight;
    const pickAnchor = (radiusFrom: PlaceWithSafety | null) =>
      selectTopCandidates(all, used, 1, (c) => {
        if (c.contentTypeId === 39) return null;
        if (!matchesTheme(c, theme)) return null;
        if (radiusFrom) {
          const km = haversineKm(radiusFrom.lat, radiusFrom.lng, c.lat, c.lng);
          if (km > NEXT_ANCHOR_RADIUS_KM) return null;
          return { score: c.safety.score + attractionBonus(c), km };
        }
        if (c.sigunguCode !== sigunguCode) return null;
        return { score: c.safety.score + attractionBonus(c), km: 0 };
      })[0];

    let anchor = pickAnchor(d === 0 ? null : anchorNear);
    // 반경 내 후보 소진 시 시군 전체로 폴백
    if (!anchor && d > 0) anchor = pickAnchor(null);
    if (!anchor) break;
    used.add(anchor.contentId);

    // ── 점심: 앵커 반경 10km 음식점 (카페 제외) ──
    const lunch = selectTopCandidates(all, used, 1, (c) => {
      if (c.contentTypeId !== 39) return null;
      if (c.cat3 === CAT3_CAFE) return null;
      const km = haversineKm(anchor.lat, anchor.lng, c.lat, c.lng);
      return km <= LUNCH_RADIUS_KM ? { score: c.safety.score, km } : null;
    })[0];
    if (lunch) used.add(lunch.contentId);

    // ── 오후: 직전 스톱 반경 15km 관광지·문화시설 ──
    const from = lunch ?? anchor;
    const preferIndoor =
      anchor.safety.weatherRisk >= RECO_WEATHER_RISK_INDOOR_THRESHOLD;
    const afternoon = selectTopCandidates(all, used, 1, (c) => {
      if (c.contentTypeId !== 12 && c.contentTypeId !== 14) return null;
      const km = haversineKm(from.lat, from.lng, c.lat, c.lng);
      if (km > AFTERNOON_RADIUS_KM) return null;
      const indoorOffset = preferIndoor && c.envType === "indoor" ? 1000 : 0;
      return { score: indoorOffset + c.safety.score + attractionBonus(c), km };
    })[0];
    if (afternoon) used.add(afternoon.contentId);

    const stops: MultiDayStop[] = [
      { slot: "morning", place: anchor },
      ...(lunch ? [{ slot: "lunch" as const, place: lunch }] : []),
      ...(afternoon ? [{ slot: "afternoon" as const, place: afternoon }] : []),
    ];

    // ── 숙소 (마지막 일차 제외): 마지막 스톱 반경 15km, 최근접 5곳 중 최고 ──
    let lodging: MultiDayDay["lodging"];
    if (d < dayCount - 1) {
      const last = stops[stops.length - 1].place;
      const nearby = lodgingsByDay[d]
        .filter(
          (l) =>
            !used.has(l.contentId) &&
            l.safety.score >= COURSE_MIN_STOP_SCORE,
        )
        .map((l) => ({
          place: l,
          km: haversineKm(last.lat, last.lng, l.lat, l.lng),
        }))
        .filter((l) => l.km <= LODGING_RADIUS_KM)
        .sort((a, b) => a.km - b.km)
        .slice(0, LODGING_NEAREST_POOL)
        .sort(
          (a, b) =>
            b.place.safety.score +
            attractionBonus(b.place) -
            (a.place.safety.score + attractionBonus(a.place)) ||
            a.km - b.km,
        )[0];
      if (nearby) {
        lodging = { place: nearby.place, distanceKm: round1(nearby.km) };
        used.add(nearby.place.contentId);
        prevNight = nearby.place;
      } else {
        prevNight = stops[stops.length - 1].place;
      }
    }

    let totalKm = 0;
    const chain = [...stops.map((s) => s.place), ...(lodging ? [lodging.place] : [])];
    for (let i = 1; i < chain.length; i++) {
      totalKm += haversineKm(
        chain[i - 1].lat,
        chain[i - 1].lng,
        chain[i].lat,
        chain[i].lng,
      );
    }

    days.push({ day: d + 1, stops, lodging, totalKm: round1(totalKm) });
  }

  if (days.length === 0 || days[0].stops.length < 2) return null;
  return {
    theme,
    days,
    totalKm: round1(days.reduce((sum, d) => sum + d.totalKm, 0)),
  };
}
