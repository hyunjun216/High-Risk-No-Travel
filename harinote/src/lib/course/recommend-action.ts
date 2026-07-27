"use server";

/**
 * AI 코스 추천 서버 액션 — 팝업(클라이언트)에서 시군·프로필을 받아
 * 테마 3종 코스를 DTO로 반환한다. 테마 전환은 클라이언트 로컬 필터라
 * (sigungu, profile) 조합당 1회만 호출된다.
 */
import { getPlacesWithSafety, getPlacesWithSafetyOnDate } from "@/lib/datasource";
import { SIGUNGU_SEATS } from "@/lib/risk/regions";
import { PROFILE_LABEL, type Profile } from "@/lib/safety/types";
import { parseDate } from "@/components/search-params";
import {
  buildThemedCourses,
  CAR_COURSE_RADIUS_SCALE,
  toThemedCourseDto,
  type CourseTheme,
  type ThemedCourseDto,
} from "@/lib/course/themed";

export async function recommendCourses(
  sigunguCode: number,
  profile: Profile,
  /** 선택 날짜(YYYY-MM-DD) — 홈 날짜 스테퍼 진입 시 목록과 같은 날짜 점수로 코스 생성 */
  dateISO?: string,
  /** 이동수단 — 자차면 스톱 탐색 반경 확대 (생략 시 대중교통 기준) */
  transport?: "transit" | "car",
): Promise<Record<CourseTheme, ThemedCourseDto | null>> {
  // 서버 액션은 공개 엔드포인트 — 클라이언트 타입을 믿지 않고 검증.
  // `in`은 프로토타입 체인까지 조회해 "constructor" 같은 키가 통과(→ NaN 점수) — hasOwn 사용
  if (
    typeof sigunguCode !== "number" ||
    !Object.hasOwn(SIGUNGU_SEATS, sigunguCode) ||
    typeof profile !== "string" ||
    !Object.hasOwn(PROFILE_LABEL, profile) ||
    (transport !== undefined && transport !== "transit" && transport !== "car")
  ) {
    throw new Error("잘못된 요청입니다.");
  }
  // 날짜도 목록과 같은 규칙(parseDate: 내일~1년)으로 검증 — 무효면 오늘 모드
  const date = dateISO !== undefined ? parseDate(dateISO) : undefined;

  const courses = buildThemedCourses(
    sigunguCode,
    date
      ? await getPlacesWithSafetyOnDate(profile, date)
      : await getPlacesWithSafety(undefined, profile),
    transport === "car" ? CAR_COURSE_RADIUS_SCALE : 1,
  );
  return {
    nature: courses.nature && toThemedCourseDto(courses.nature),
    water: courses.water && toThemedCourseDto(courses.water),
    culture: courses.culture && toThemedCourseDto(courses.culture),
  };
}
