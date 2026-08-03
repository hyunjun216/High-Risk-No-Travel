/**
 * 테마별 안전 코스 3선 — 하루 코스 추천 팝업(CourseRecommendModal) 코어 로직.
 * half-day.ts와 같은 구조(오전 앵커 → 점심 10km 음식점 → 오후 15km 관광지·문화시설)로
 * 시군 단위 테마 코스를 만들고, 각 슬롯에 "대안 교체" 후보(최대 2개)를 함께 담는다.
 *
 * half-day.ts를 리팩터링하지 않고 동일 조건의 후보 선정을 자체 구현했다 —
 * 기존 export(buildHalfDayCourse) 시그니처·동작을 건드리지 않는 단순한 쪽 선택.
 *
 * 규칙:
 * - 앵커: 해당 시군(sigunguCode) 내 테마 매칭 장소 중 안전점수 최고
 *   (동점이면 contentId 오름차순 — 일관 규칙)
 * - 점심: 앵커 반경 10km 내 음식점(39), 오후: 직전 스톱 반경 15km 내 관광지(12)·문화시설(14)
 *   — 점심·오후는 시군 경계를 넘어도 반경 내면 허용
 * - 모든 스톱·대안은 **안전층 감점만으로** 최소 점수(60) 이상만 — meetsCourseSafety
 * - 대안(alternates)은 같은 슬롯 선정 조건(반경·유형)의 차순위 후보 최대 2개,
 *   앵커·다른 스톱·다른 대안과 중복 금지
 * - 테마 매칭 앵커가 없거나 스톱이 2개 미만이면 그 테마는 null
 */
import type { PlaceWithSafety } from "@/lib/datasource";
import { CAT3_CAFE, type PlaceEnvType } from "@/lib/tour/types";
import type { RiskLevel } from "@/lib/safety/types";
import {
  RECO_WEATHER_RISK_INDOOR_THRESHOLD,
} from "@/lib/safety/weights";
import { meetsCourseSafety } from "@/lib/safety/layers";
import { haversineKm } from "@/lib/reco/distance";
import { CURATED_PLACES } from "@/lib/curation";

export type CourseTheme = "nature" | "water" | "culture";

export const COURSE_THEME_META: Record<
  CourseTheme,
  { label: string; desc: string; emoji: string }
> = {
  nature: {
    label: "자연 힐링",
    desc: "산과 들에서 쉬어가는 야외 중심 코스",
    emoji: "🌿",
  },
  water: {
    label: "바다·물놀이",
    desc: "해안과 계곡·호수를 즐기는 수변 코스",
    emoji: "🌊",
  },
  culture: {
    label: "문화·실내",
    desc: "박물관·미술관 등 날씨 걱정 적은 실내 코스",
    emoji: "🏛️",
  },
};

export type CourseSlot = "morning" | "lunch" | "afternoon";

export interface ThemedCourseStop {
  slot: CourseSlot;
  place: PlaceWithSafety;
  /** 같은 슬롯 조건의 차순위 후보 (교체용, 최대 2개) */
  alternates: PlaceWithSafety[];
}

export interface ThemedCourse {
  theme: CourseTheme;
  stops: ThemedCourseStop[]; // 오전 → 점심 → 오후 순
  /** 추천 스톱 기준 이동 거리 합 (km, 소수 1자리) */
  totalKm: number;
}

/** 점심(음식점) 탐색 반경 — half-day.ts와 동일 (multi-day.ts도 공유) */
export const LUNCH_RADIUS_KM = 10;
/** 오후 스톱 탐색 반경 (직전 스톱 기준) — half-day.ts와 동일 (multi-day.ts도 공유) */
export const AFTERNOON_RADIUS_KM = 15;
/**
 * 자차 이동 시 스톱 탐색 반경 배율 — half-day.ts의 radiusScale 관례(자차 ×1.5,
 * 점심 15km·오후 22.5km)와 동일. 대체지의 30→50km(alternatives.ts CAR_DISTANCE_KM)와
 * 같은 취지의 "자차는 더 넓게" 차등. 상세 페이지(places/[contentId])는 인라인 1.5를
 * 쓰고 있다 — 값 변경 시 함께 맞출 것.
 */
export const CAR_COURSE_RADIUS_SCALE = 1.5;
/**
 * 오후 후보가 코스 테마와 같은 유형이면 주는 소폭 가점.
 * 감점 가중치가 아닌 UI 추천 우대 값이라 weights.ts가 아닌 여기에 둔다
 * (half-day.ts의 SAME_CAT3_BONUS와 같은 수준).
 */
const SAME_THEME_BONUS = 3;

/**
 * 관광 매력도 우대 — 안전점수만으로 뽑으면 90점대가 밀집한 시군에서
 * 사진도 없는 무명 시설(요가원 등)이 대표 관광지를 제치는 문제 보정.
 * 큐레이션(에디터 선정) > TourAPI 대표사진 보유. 감점 가중치가 아닌
 * UI 추천 우대 값이라 weights.ts가 아닌 여기에 둔다.
 * 관광 스톱(오전·오후)에만 적용 — 점심(음식점)은 사진 유무가 품질 신호로 약하다.
 */
const CURATED_BONUS = 6;
const PHOTO_BONUS = 4;
const CURATED_IDS = new Set(CURATED_PLACES.map((c) => c.contentId));

export function attractionBonus(p: PlaceWithSafety): number {
  return (
    (CURATED_IDS.has(p.contentId) ? CURATED_BONUS : 0) +
    (p.imageUrl ? PHOTO_BONUS : 0)
  );
}

const NATURE_ENV: readonly PlaceEnvType[] = [
  "outdoor_mountain",
  "outdoor_general",
];
const WATER_ENV: readonly PlaceEnvType[] = ["outdoor_coast", "outdoor_water"];

/** 장소가 테마에 매칭되는가 */
export function matchesTheme(
  place: PlaceWithSafety,
  theme: CourseTheme,
): boolean {
  switch (theme) {
    case "nature":
      return place.contentTypeId === 12 && NATURE_ENV.includes(place.envType);
    case "water":
      return WATER_ENV.includes(place.envType);
    case "culture":
      return place.envType === "indoor" || place.contentTypeId === 14;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * 후보를 정렬해 상위 n개 반환 — 스톱(1위) + 대안(2~3위)이 같은 조건을 공유한다.
 * 정렬: rankScore 내림차순 → 거리 오름차순 → contentId 오름차순(동점 일관 규칙)
 */
export function selectTopCandidates(
  candidates: PlaceWithSafety[],
  used: Set<number>,
  n: number,
  rankOf: (c: PlaceWithSafety) => { score: number; km: number } | null,
): PlaceWithSafety[] {
  const ranked: { place: PlaceWithSafety; score: number; km: number }[] = [];
  for (const c of candidates) {
    if (used.has(c.contentId)) continue;
    if (!meetsCourseSafety(c.safety)) continue;
    const rank = rankOf(c);
    if (rank === null) continue;
    ranked.push({ place: c, ...rank });
  }
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      a.km - b.km ||
      a.place.contentId - b.place.contentId,
  );
  return ranked.slice(0, n).map((r) => r.place);
}

function buildThemedCourse(
  theme: CourseTheme,
  sigunguCode: number,
  all: PlaceWithSafety[],
  /** 이동수단별 반경 배율 — 자차 CAR_COURSE_RADIUS_SCALE (half-day.ts 관례) */
  radiusScale = 1,
): ThemedCourse | null {
  const used = new Set<number>();

  // ── 오전: 시군 내 테마 매칭 장소(음식점 제외) 중 안전점수 최고 ──
  const morningPicks = selectTopCandidates(all, used, 3, (c) => {
    if (c.sigunguCode !== sigunguCode) return null;
    if (c.contentTypeId === 39) return null;
    if (!matchesTheme(c, theme)) return null;
    return { score: c.safety.score + attractionBonus(c), km: 0 };
  });
  const anchor = morningPicks[0];
  if (!anchor) return null;
  for (const p of morningPicks) used.add(p.contentId);

  // ── 점심: 앵커 반경 10km 내 음식점 (시군 경계 무관) ──
  const lunchPicks = selectTopCandidates(all, used, 3, (c) => {
    if (c.contentTypeId !== 39) return null;
    // 점심 슬롯은 식사 목적 — 카페/전통찻집(A05020900)은 제외
    if (c.cat3 === CAT3_CAFE) return null;
    const km = haversineKm(anchor.lat, anchor.lng, c.lat, c.lng);
    return km <= LUNCH_RADIUS_KM * radiusScale
      ? { score: c.safety.score, km }
      : null;
  });
  const lunch = lunchPicks[0];
  for (const p of lunchPicks) used.add(p.contentId);

  // ── 오후: 직전 스톱 반경 15km 내 관광지·문화시설 ──
  // half-day.ts와 동일하게 악천후면 실내 우선, 테마 일치엔 소폭 우대
  const from = lunch ?? anchor;
  const preferIndoor =
    anchor.safety.weatherRisk >= RECO_WEATHER_RISK_INDOOR_THRESHOLD;
  const afternoonPicks = selectTopCandidates(all, used, 3, (c) => {
    if (c.contentTypeId !== 12 && c.contentTypeId !== 14) return null;
    const km = haversineKm(from.lat, from.lng, c.lat, c.lng);
    if (km > AFTERNOON_RADIUS_KM * radiusScale) return null;
    // 실내 우선은 점수·거리보다 앞서야 하므로 큰 오프셋으로 계층화
    const indoorOffset = preferIndoor && c.envType === "indoor" ? 1000 : 0;
    const themeBonus = matchesTheme(c, theme) ? SAME_THEME_BONUS : 0;
    return {
      score: indoorOffset + c.safety.score + themeBonus + attractionBonus(c),
      km,
    };
  });
  const afternoon = afternoonPicks[0];

  const stops: ThemedCourseStop[] = [
    { slot: "morning", place: anchor, alternates: morningPicks.slice(1) },
    ...(lunch
      ? [
          {
            slot: "lunch" as const,
            place: lunch,
            alternates: lunchPicks.slice(1),
          },
        ]
      : []),
    ...(afternoon
      ? [
          {
            slot: "afternoon" as const,
            place: afternoon,
            alternates: afternoonPicks.slice(1),
          },
        ]
      : []),
  ];
  if (stops.length < 2) return null;

  let totalKm = 0;
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1].place;
    const cur = stops[i].place;
    totalKm += haversineKm(prev.lat, prev.lng, cur.lat, cur.lng);
  }

  return { theme, stops, totalKm: round1(totalKm) };
}

export const COURSE_THEMES: readonly CourseTheme[] = [
  "nature",
  "water",
  "culture",
];

export function buildThemedCourses(
  sigunguCode: number,
  all: PlaceWithSafety[],
  radiusScale = 1,
): Record<CourseTheme, ThemedCourse | null> {
  return {
    nature: buildThemedCourse("nature", sigunguCode, all, radiusScale),
    water: buildThemedCourse("water", sigunguCode, all, radiusScale),
    culture: buildThemedCourse("culture", sigunguCode, all, radiusScale),
  };
}

// ─────────────────────────────────────────────
// 클라이언트 전달용 얇은 DTO — CourseCard가 safety 전체 대신 필요한 필드만 받는다
// (변환은 서버에서 수행; 클라 컴포넌트는 datasource를 import하지 않는다)
// ─────────────────────────────────────────────
export interface CoursePlaceDto {
  contentId: number;
  title: string;
  lat: number;
  lng: number;
  score: number;
  grade: RiskLevel;
  envType: PlaceEnvType;
  contentTypeId: number;
  imageUrl?: string;
}

export interface ThemedCourseStopDto {
  slot: CourseSlot;
  place: CoursePlaceDto;
  alternates: CoursePlaceDto[];
}

export interface ThemedCourseDto {
  theme: CourseTheme;
  stops: ThemedCourseStopDto[];
  totalKm: number;
}

export function toPlaceDto(p: PlaceWithSafety): CoursePlaceDto {
  return {
    contentId: p.contentId,
    title: p.title,
    lat: p.lat,
    lng: p.lng,
    score: p.safety.score,
    grade: p.safety.grade,
    envType: p.envType,
    contentTypeId: p.contentTypeId,
    imageUrl: p.imageUrl,
  };
}

export function toThemedCourseDto(course: ThemedCourse): ThemedCourseDto {
  return {
    theme: course.theme,
    totalKm: course.totalKm,
    stops: course.stops.map((s) => ({
      slot: s.slot,
      place: toPlaceDto(s.place),
      alternates: s.alternates.map(toPlaceDto),
    })),
  };
}
