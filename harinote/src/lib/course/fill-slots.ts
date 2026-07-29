/**
 * 빈 슬롯 채우기 엔진 — 사용자가 담아둔 스톱(앵커)을 불변으로 존중하면서
 * 계획의 빈 시간 슬롯만 추천으로 채운다. multi-day.ts의 일차 루프 구조를
 * 일반화한 것으로, 앵커 0개면 기존 N박 전체 추천과 동일하게 동작한다.
 *
 * 규칙 (themed.ts·multi-day.ts의 슬롯 규칙 계승):
 * - 앵커: 절대 바꾸지 않고, 어느 일차에서도 다시 추천하지 않는다(중복 금지)
 * - 오전: 기준점(전날 숙소 > 전날 마지막 스톱 > 그날 첫 앵커) 반경 25km 내
 *   테마 매칭 — 기준점이 없으면 시군 내 최고점(1일차·앵커 없음), 반경 내
 *   후보 소진 시 시군 전체 폴백
 * - 점심 10km 음식점(카페 제외) / 오후 15km 관광지·문화시설(악천후 실내 우선)
 * - 저녁: 직전 스톱 반경 10km 음식점(카페 제외) — 점심과 같은 규칙
 * - 숙소(마지막 일차 제외): 그날 마지막 스톱 반경 15km, 최근접 5곳 중
 *   (안전점수+사진 우대) 최고. 앵커 숙소가 있으면 그것이 다음 날 기준점
 * - 모든 스톱은 안전점수 COURSE_MIN_STOP_SCORE(60) 이상 + 대안 최대 2개
 */
import type { PlaceWithSafety } from "@/lib/datasource";
import { CAT3_CAFE } from "@/lib/tour/types";
import type { PlanSlot } from "@/lib/travel-plan";
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
  type CourseTheme,
} from "@/lib/course/themed";

/** 2일차+ 오전 기준점 탐색 반경 (전날 숙소·마지막 스톱 기준) — multi-day 규칙 유지 */
const NEXT_ANCHOR_RADIUS_KM = 25;
/** 숙소 탐색 반경 (그날 마지막 스톱 기준) — multi-day 규칙 유지 */
const LODGING_RADIUS_KM = 15;
/** 숙소는 최근접 N곳 중에서 점수·사진으로 고른다 — multi-day 규칙 유지 */
const LODGING_NEAREST_POOL = 5;
/** 스톱당 대안 수 */
const ALTERNATE_COUNT = 2;

/** 사용자가 담아둔 스톱 — 좌표는 서버에서 해석된 값 (클라이언트 입력을 믿지 않음) */
export interface FillAnchor {
  contentId: number;
  slot: PlanSlot;
  lat: number;
  lng: number;
}

/** 채워진 슬롯 하나 — 앵커는 결과에 포함하지 않는다 */
export interface SlotFill {
  /** 1-based 일차 */
  day: number;
  slot: PlanSlot;
  place: PlaceWithSafety;
  /** 같은 조건의 차순위 후보 (최대 ALTERNATE_COUNT) */
  alternates: PlaceWithSafety[];
  /** 기준점에서의 직선거리 (기준점 없으면 0) */
  distanceKm: number;
}

interface Point {
  lat: number;
  lng: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 낮 시간 슬롯 처리 순서 (숙소는 일차 마지막에 별도 처리) */
const DAY_SLOTS: readonly PlanSlot[] = ["morning", "lunch", "afternoon", "evening"];

export function fillPlanSlots(opts: {
  theme: CourseTheme;
  /** 기준점이 전혀 없는 일차의 오전 폴백 — 없으면 그 일차는 채우지 못한다 */
  sigunguCode?: number;
  /** 일차별 앵커 (사용자가 담아둔 스톱). 길이 = 총 일수 */
  anchorsByDay: FillAnchor[][];
  /** 일차별(그 날짜 기준 점수) 관광지 후보 — 길이 = 총 일수 */
  candidatesByDay: PlaceWithSafety[][];
  /** 일차별 점수 계산된 숙박(32) 후보 — 마지막 일차는 사용 안 함 */
  lodgingsByDay: PlaceWithSafety[][];
  /** 이동수단별 점심·오후·저녁 탐색 반경 배율 (자차 CAR_COURSE_RADIUS_SCALE) */
  radiusScale?: number;
}): SlotFill[] {
  const {
    theme,
    sigunguCode,
    anchorsByDay,
    candidatesByDay,
    lodgingsByDay,
    radiusScale = 1,
  } = opts;
  const dayCount = candidatesByDay.length;
  const fills: SlotFill[] = [];

  // 앵커는 어느 일차에서도 재추천 금지
  const used = new Set<number>();
  for (const dayAnchors of anchorsByDay) {
    for (const a of dayAnchors) used.add(a.contentId);
  }

  // 전날 밤 기준점 (앵커 숙소 > 채운 숙소 > 그날 마지막 스톱)
  let prevNight: Point | null = null;

  for (let d = 0; d < dayCount; d++) {
    const all = candidatesByDay[d];
    const anchors = anchorsByDay[d] ?? [];
    const anchorsBySlot = new Map<PlanSlot, FillAnchor[]>();
    for (const a of anchors) {
      const list = anchorsBySlot.get(a.slot) ?? [];
      list.push(a);
      anchorsBySlot.set(a.slot, list);
    }
    // 슬롯 순서상 가장 이른 앵커 — 오전 기준점 폴백용
    const firstAnchor =
      DAY_SLOTS.flatMap((s) => anchorsBySlot.get(s) ?? [])[0] ??
      (anchorsBySlot.get("lodging") ?? [])[0] ??
      null;

    // 체인 위치 — 슬롯 순서대로 앵커·채움을 따라간다
    let last: Point | null = null;
    // 오전 스톱(악천후 실내 우선 판단용) — 채운 경우만 안전정보를 안다
    let morningPlace: PlaceWithSafety | null = null;

    for (const slot of DAY_SLOTS) {
      const slotAnchors = anchorsBySlot.get(slot);
      if (slotAnchors && slotAnchors.length > 0) {
        last = slotAnchors[slotAnchors.length - 1];
        continue; // 앵커가 차지한 슬롯은 채우지 않는다
      }

      if (slot === "morning") {
        const ref = prevNight ?? firstAnchor;
        const pick = (radiusFrom: Point | null) =>
          selectTopCandidates(all, used, 1 + ALTERNATE_COUNT, (c) => {
            if (c.contentTypeId === 39 || c.contentTypeId === 32) return null;
            if (!matchesTheme(c, theme)) return null;
            if (radiusFrom) {
              const km = haversineKm(radiusFrom.lat, radiusFrom.lng, c.lat, c.lng);
              if (km > NEXT_ANCHOR_RADIUS_KM) return null;
              return { score: c.safety.score + attractionBonus(c), km };
            }
            if (sigunguCode === undefined || c.sigunguCode !== sigunguCode) {
              return null;
            }
            return { score: c.safety.score + attractionBonus(c), km: 0 };
          });
        let picks = pick(ref);
        // 반경 내 후보 소진 시 시군 전체 폴백 — multi-day 규칙 유지
        if (picks.length === 0 && ref) picks = pick(null);
        const place = picks[0];
        if (place) {
          used.add(place.contentId);
          fills.push({
            day: d + 1,
            slot,
            place,
            alternates: picks.slice(1),
            distanceKm: ref
              ? round1(haversineKm(ref.lat, ref.lng, place.lat, place.lng))
              : 0,
          });
          last = place;
          morningPlace = place;
        }
        continue;
      }

      // 점심·오후·저녁은 직전 스톱(앵커 포함)이 기준 — 없으면 채울 수 없다
      const ref = last;
      if (!ref) continue;

      let picks: PlaceWithSafety[] = [];
      if (slot === "lunch" || slot === "evening") {
        picks = selectTopCandidates(all, used, 1 + ALTERNATE_COUNT, (c) => {
          if (c.contentTypeId !== 39) return null;
          if (c.cat3 === CAT3_CAFE) return null;
          const km = haversineKm(ref.lat, ref.lng, c.lat, c.lng);
          return km <= LUNCH_RADIUS_KM * radiusScale
            ? { score: c.safety.score, km }
            : null;
        });
      } else {
        // afternoon
        const preferIndoor =
          (morningPlace?.safety.weatherRisk ?? 0) >=
          RECO_WEATHER_RISK_INDOOR_THRESHOLD;
        picks = selectTopCandidates(all, used, 1 + ALTERNATE_COUNT, (c) => {
          if (c.contentTypeId !== 12 && c.contentTypeId !== 14) return null;
          const km = haversineKm(ref.lat, ref.lng, c.lat, c.lng);
          if (km > AFTERNOON_RADIUS_KM * radiusScale) return null;
          const indoorOffset = preferIndoor && c.envType === "indoor" ? 1000 : 0;
          return { score: indoorOffset + c.safety.score + attractionBonus(c), km };
        });
      }
      const place = picks[0];
      if (place) {
        used.add(place.contentId);
        fills.push({
          day: d + 1,
          slot,
          place,
          alternates: picks.slice(1),
          distanceKm: round1(haversineKm(ref.lat, ref.lng, place.lat, place.lng)),
        });
        last = place;
      }
    }

    // ── 숙소 (마지막 일차 제외) ──
    const lodgingAnchors = anchorsBySlot.get("lodging");
    if (lodgingAnchors && lodgingAnchors.length > 0) {
      prevNight = lodgingAnchors[lodgingAnchors.length - 1];
      continue;
    }
    if (d >= dayCount - 1) {
      prevNight = last ?? prevNight;
      continue;
    }
    if (!last) {
      // 이 일차에 아무 스톱도 없으면 숙소 기준점이 없다
      continue;
    }
    const anchorPoint = last;
    const nearby = (lodgingsByDay[d] ?? [])
      .filter(
        (l) => !used.has(l.contentId) && l.safety.score >= COURSE_MIN_STOP_SCORE,
      )
      .map((l) => ({
        place: l,
        km: haversineKm(anchorPoint.lat, anchorPoint.lng, l.lat, l.lng),
      }))
      .filter((l) => l.km <= LODGING_RADIUS_KM)
      .sort((a, b) => a.km - b.km)
      .slice(0, LODGING_NEAREST_POOL)
      .sort(
        (a, b) =>
          b.place.safety.score +
          attractionBonus(b.place) -
          (a.place.safety.score + attractionBonus(a.place)) || a.km - b.km,
      )[0];
    if (nearby) {
      used.add(nearby.place.contentId);
      fills.push({
        day: d + 1,
        slot: "lodging",
        place: nearby.place,
        alternates: [],
        distanceKm: round1(nearby.km),
      });
      prevNight = nearby.place;
    } else {
      prevNight = last;
    }
  }

  return fills;
}
