"use server";

/**
 * 빈 슬롯 채우기 서버 액션 — 플래너의 담긴 스톱(앵커)·박수·출발일·프로필을 받아
 * 빈 시간 슬롯만 그 일차 날짜 기준 점수로 채워 DTO로 반환한다.
 * 앵커 0개면 기존 N박 전체 추천과 동일 동작 (multi-day-action을 대체).
 * 날짜 규칙은 계획 안전 진단(diagnose-action)과 동일: 오늘 실황 / 예보 / 계절 통계.
 */
import {
  getDateSafety,
  getPlace,
  getPlacesWithSafety,
  getPlacesWithSafetyOnDate,
  getSpotSafety,
  type PlaceWithSafety,
} from "@/lib/datasource";
import { PROFILE_LABEL, type Profile } from "@/lib/safety/types";
import { SIGUNGU_SEATS } from "@/lib/risk/regions";
import { addDaysISO, dayOffsetSeoul, isValidISODate, todayISOSeoul } from "@/lib/date";
import { getLodgings, lodgingById } from "@/lib/tour/lodging";
import { SLOT_META, type PlanSlot } from "@/lib/travel-plan";
import { fillPlanSlots, type FillAnchor } from "@/lib/course/fill-slots";
import {
  CAR_COURSE_RADIUS_SCALE,
  COURSE_THEME_META,
  toPlaceDto,
  type CoursePlaceDto,
  type CourseTheme,
} from "@/lib/course/themed";

const MAX_DAYS = 4; // 플래너 상한(3박 4일)과 동일
const MAX_ANCHORS = 40; // 리포트 상한(REPORT_MAX_STOPS)과 동일한 방어 상한

export interface FillAnchorInput {
  contentId: number;
  /** 1-based 일차 */
  day: number;
  slot: PlanSlot;
}

export interface SlotFillDto {
  day: number;
  slot: PlanSlot;
  place: CoursePlaceDto;
  alternates: CoursePlaceDto[];
  distanceKm: number;
}

export interface FillSlotsDto {
  fills: SlotFillDto[];
  /** 일차별 평가 날짜 (1일차부터) */
  dates: string[];
  assumedToday: boolean;
}

export async function fillEmptySlots(input: {
  /** 담아둔 스톱 — 빈 배열이면 전체 추천 (이때 sigunguCode 필수) */
  anchors: FillAnchorInput[];
  theme: CourseTheme;
  /** 앵커가 없을 때 1일차 오전의 출발 시군 */
  sigunguCode?: number;
  profile: Profile;
  /** 총 일수 (당일=1 ~ 3박4일=4) */
  days: number;
  /** 출발일 (YYYY-MM-DD) — 없으면 오늘 출발 가정 */
  from?: string;
  /** 이동수단 — 자차면 스톱 탐색 반경 확대 (생략 시 대중교통 기준) */
  transport?: "transit" | "car";
}): Promise<FillSlotsDto> {
  // 서버 액션은 공개 엔드포인트 — 클라이언트 타입을 믿지 않고 검증 (diagnose-action과 동일 원칙)
  if (
    typeof input !== "object" ||
    input === null ||
    !Array.isArray(input.anchors) ||
    input.anchors.length > MAX_ANCHORS ||
    typeof input.theme !== "string" ||
    !Object.hasOwn(COURSE_THEME_META, input.theme) ||
    typeof input.profile !== "string" ||
    !Object.hasOwn(PROFILE_LABEL, input.profile) ||
    !Number.isInteger(input.days) ||
    input.days < 1 ||
    input.days > MAX_DAYS ||
    (input.sigunguCode !== undefined &&
      (typeof input.sigunguCode !== "number" ||
        !Object.hasOwn(SIGUNGU_SEATS, input.sigunguCode))) ||
    (input.anchors.length === 0 && input.sigunguCode === undefined) ||
    (input.transport !== undefined &&
      input.transport !== "transit" &&
      input.transport !== "car")
  ) {
    throw new Error("잘못된 요청입니다.");
  }
  for (const a of input.anchors) {
    if (
      typeof a !== "object" ||
      a === null ||
      typeof a.contentId !== "number" ||
      !Number.isInteger(a.contentId) ||
      !Number.isInteger(a.day) ||
      a.day < 1 ||
      a.day > input.days ||
      typeof a.slot !== "string" ||
      !Object.hasOwn(SLOT_META, a.slot)
    ) {
      throw new Error("잘못된 요청입니다.");
    }
  }

  const today = todayISOSeoul();
  const fromValid =
    typeof input.from === "string" &&
    isValidISODate(input.from) &&
    dayOffsetSeoul(input.from) >= 0 &&
    dayOffsetSeoul(input.from) <= 365;
  const baseISO = fromValid ? (input.from as string) : today;

  // 앵커 좌표는 클라이언트를 믿지 않고 서버에서 해석 —
  // 관광지에 없으면 숙박 데이터셋 폴백, 둘 다 없으면 앵커에서 제외
  // (미지 contentId는 후보 풀에도 없으므로 중복 추천 위험이 없다)
  const anchorsByDay: FillAnchor[][] = Array.from(
    { length: input.days },
    () => [],
  );
  for (const a of input.anchors) {
    const place = (await getPlace(a.contentId)) ?? lodgingById(a.contentId);
    if (!place) continue;
    anchorsByDay[a.day - 1].push({
      contentId: a.contentId,
      slot: a.slot,
      lat: place.lat,
      lng: place.lng,
    });
  }

  const lodgings = getLodgings();
  const candidatesByDay: PlaceWithSafety[][] = [];
  const lodgingsByDay: PlaceWithSafety[][] = [];
  const dates: string[] = [];

  for (let d = 0; d < input.days; d++) {
    const dateISO = addDaysISO(baseISO, d);
    dates.push(dateISO);
    const isToday = dateISO === today;

    candidatesByDay.push(
      isToday
        ? await getPlacesWithSafety(undefined, input.profile)
        : await getPlacesWithSafetyOnDate(input.profile, dateISO),
    );

    // 숙소 채점은 그 일차에 숙소를 채울 때만 — 마지막 일차·앵커 숙소가 있는 일차는 불필요
    const hasLodgingAnchor = anchorsByDay[d].some((a) => a.slot === "lodging");
    if (d === input.days - 1 || hasLodgingAnchor) {
      lodgingsByDay.push([]);
      continue;
    }
    const scored = await Promise.all(
      lodgings.map(async (l) => {
        const breakdown = isToday
          ? await getSpotSafety(l, input.profile)
          : ((await getDateSafety(l, input.profile, dateISO))?.breakdown ?? null);
        return breakdown ? ({ ...l, safety: breakdown } as PlaceWithSafety) : null;
      }),
    );
    lodgingsByDay.push(scored.filter((l): l is PlaceWithSafety => l !== null));
  }

  const fills = fillPlanSlots({
    theme: input.theme,
    sigunguCode: input.sigunguCode,
    anchorsByDay,
    candidatesByDay,
    lodgingsByDay,
    radiusScale: input.transport === "car" ? CAR_COURSE_RADIUS_SCALE : 1,
  });

  return {
    fills: fills.map((f) => ({
      day: f.day,
      slot: f.slot,
      place: toPlaceDto(f.place),
      alternates: f.alternates.map(toPlaceDto),
      distanceKm: f.distanceKm,
    })),
    dates,
    assumedToday: !fromValid,
  };
}
