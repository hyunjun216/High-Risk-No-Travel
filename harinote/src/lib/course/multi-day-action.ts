"use server";

/**
 * N박 전체 코스 추천 서버 액션 — 플래너의 박수·출발일·프로필에 맞춰
 * 일차별 스톱(그 일차 날짜 기준 점수) + 밤 숙소를 만들어 DTO로 반환한다.
 * 날짜 규칙은 계획 안전 진단(diagnose-action)과 동일: 오늘 실황 / 예보 / 계절 통계.
 */
import {
  getDateSafety,
  getPlacesWithSafety,
  getPlacesWithSafetyOnDate,
  getSpotSafety,
  type PlaceWithSafety,
} from "@/lib/datasource";
import { PROFILE_LABEL, type Profile } from "@/lib/safety/types";
import { SIGUNGU_SEATS } from "@/lib/risk/regions";
import { addDaysISO, dayOffsetSeoul, isValidISODate, todayISOSeoul } from "@/lib/date";
import { getLodgings } from "@/lib/tour/lodging";
import { buildMultiDayCourse } from "@/lib/course/multi-day";
import {
  CAR_COURSE_RADIUS_SCALE,
  COURSE_THEME_META,
  toPlaceDto,
  type CoursePlaceDto,
  type CourseSlot,
  type CourseTheme,
} from "@/lib/course/themed";

const MAX_DAYS = 4; // 플래너 상한(3박 4일)과 동일

export interface MultiDayStopDto {
  slot: CourseSlot;
  place: CoursePlaceDto;
}

export interface MultiDayDayDto {
  day: number;
  /** 이 일차가 평가된 날짜 — 출발일 미설정이면 오늘 출발 가정 */
  dateISO: string;
  stops: MultiDayStopDto[];
  lodging?: { place: CoursePlaceDto; distanceKm: number };
  totalKm: number;
}

export interface MultiDayCourseDto {
  theme: CourseTheme;
  days: MultiDayDayDto[];
  totalKm: number;
  assumedToday: boolean;
}

export async function recommendMultiDayCourse(input: {
  sigunguCode: number;
  theme: CourseTheme;
  profile: Profile;
  /** 총 일수 (당일=1 ~ 3박4일=4) */
  days: number;
  /** 출발일 (YYYY-MM-DD) — 없으면 오늘 출발 가정 */
  from?: string;
  /** 이동수단 — 자차면 스톱 탐색 반경 확대 (생략 시 대중교통 기준) */
  transport?: "transit" | "car";
}): Promise<MultiDayCourseDto | null> {
  // 서버 액션은 공개 엔드포인트 — 클라이언트 타입을 믿지 않고 검증
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.sigunguCode !== "number" ||
    !Object.hasOwn(SIGUNGU_SEATS, input.sigunguCode) ||
    typeof input.theme !== "string" ||
    !Object.hasOwn(COURSE_THEME_META, input.theme) ||
    typeof input.profile !== "string" ||
    !Object.hasOwn(PROFILE_LABEL, input.profile) ||
    !Number.isInteger(input.days) ||
    input.days < 1 ||
    input.days > MAX_DAYS ||
    (input.transport !== undefined &&
      input.transport !== "transit" &&
      input.transport !== "car")
  ) {
    throw new Error("잘못된 요청입니다.");
  }

  const today = todayISOSeoul();
  const fromValid =
    typeof input.from === "string" &&
    isValidISODate(input.from) &&
    dayOffsetSeoul(input.from) >= 0 &&
    dayOffsetSeoul(input.from) <= 365;
  const baseISO = fromValid ? (input.from as string) : today;

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

    // 숙소는 마지막 일차엔 필요 없다 — 빈 배열로 채워 인덱스만 맞춘다
    if (d === input.days - 1) {
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

  const course = buildMultiDayCourse(
    input.theme,
    input.sigunguCode,
    candidatesByDay,
    lodgingsByDay,
    input.transport === "car" ? CAR_COURSE_RADIUS_SCALE : 1,
  );
  if (!course) return null;

  return {
    theme: course.theme,
    totalKm: course.totalKm,
    assumedToday: !fromValid,
    days: course.days.map((day) => ({
      day: day.day,
      dateISO: dates[day.day - 1],
      totalKm: day.totalKm,
      stops: day.stops.map((s) => ({ slot: s.slot, place: toPlaceDto(s.place) })),
      lodging: day.lodging && {
        place: toPlaceDto(day.lodging.place),
        distanceKm: day.lodging.distanceKm,
      },
    })),
  };
}
