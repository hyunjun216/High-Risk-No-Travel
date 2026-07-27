/** URL 쿼리 파라미터 파싱 유틸 — UI 전용 */
import { PROFILE_LABEL, type Profile } from "@/lib/safety/types";
import {
  addDaysISO,
  dayOffsetSeoul,
  isValidISODate,
  nightsBetween,
} from "@/lib/date";
import { RISK_TYPE_META, type RiskTypeKey } from "@/lib/tour/risk-types";
import { SIGUNGU_SEATS } from "@/lib/risk/regions";
import {
  CAT3_CAFE,
  SUPPORTED_CONTENT_TYPE_IDS,
  type ContentTypeId,
} from "@/lib/tour/types";
export type SearchParamValue = string | string[] | undefined;

export function first(v: SearchParamValue): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseProfile(v: SearchParamValue): Profile {
  const s = first(v);
  return s && s in PROFILE_LABEL ? (s as Profile) : "default";
}

/** 유형 탭 파라미터 — 대분류(contentTypeId) 또는 "cafe" 소분류 슬러그 */
export type PlaceTypeParam = ContentTypeId | "cafe";

/** 유형 파라미터 파싱 — "cafe" 슬러그 또는 SUPPORTED 화이트리스트 숫자만 허용 */
export function parsePlaceType(
  v: SearchParamValue,
): PlaceTypeParam | undefined {
  const s = first(v);
  if (s === "cafe") return "cafe";
  const n = Number(s);
  return (SUPPORTED_CONTENT_TYPE_IDS as readonly number[]).includes(n)
    ? (n as ContentTypeId)
    : undefined;
}

/** 유형 파라미터 → PlaceQuery 필드 — "cafe"는 음식점(39) + cat3 소분류 조합 */
export function placeTypeToQuery(t?: PlaceTypeParam): {
  contentTypeId?: ContentTypeId;
  cat3?: string;
} {
  if (t === undefined) return {};
  if (t === "cafe") return { contentTypeId: 39, cat3: CAT3_CAFE };
  return { contentTypeId: t };
}

/**
 * 강원 시군구 코드 목록 파싱 — 콤마 구분 복수값(sigungu=1,5).
 * SIGUNGU_SEATS에 있는 코드(1~18)만 허용, 중복 제거·오름차순 정렬(URL 정규형).
 * 단일값(sigungu=3, 홈 대시보드 진입 링크)도 [3]으로 수용. 빈 배열 = 필터 없음.
 */
export function parseSigunguList(v: SearchParamValue): number[] {
  const s = first(v);
  if (!s) return [];
  const codes = s.split(",").map(Number).filter((n) => n in SIGUNGU_SEATS);
  return [...new Set(codes)].sort((a, b) => a - b);
}

/** 시군 목록 → URL 파라미터 값 — 빈 목록은 생략 */
export function sigunguParam(codes: number[]): string | undefined {
  return codes.length > 0 ? codes.join(",") : undefined;
}

/** 시군 선택 요약 라벨 — "시군 전체" / "강릉시" / "강릉·속초" / "강릉·속초 외 N곳" */
export function sigunguSummaryLabel(codes: number[]): string {
  if (codes.length === 0) return "시군 전체";
  if (codes.length === 1) return SIGUNGU_SEATS[codes[0]].name;
  const short = (code: number) =>
    SIGUNGU_SEATS[code].name.replace(/[시군]$/, "");
  const head = `${short(codes[0])}·${short(codes[1])}`;
  return codes.length === 2 ? head : `${head} 외 ${codes.length - 2}곳`;
}

/** 페이지 번호 파싱 — 1 이상의 정수만 허용, 잘못된 값은 1 */
export function parsePage(v: SearchParamValue): number {
  const n = Number(first(v));
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** 빈 값(undefined, "")을 제외하고 쿼리스트링 생성 ("?q=..&profile=.." 또는 "") */
export function buildQuery(
  params: Record<string, string | number | undefined>,
): string {
  const sp = new URLSearchParams();
  for (const [k, val] of Object.entries(params)) {
    if (val !== undefined && val !== "") sp.set(k, String(val));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** profile=default는 URL에서 생략 */
export function profileParam(profile: Profile): string | undefined {
  return profile === "default" ? undefined : profile;
}

/** 반려동물 동반 필터 — pet=1일 때만 true */
export function parsePet(v: SearchParamValue): boolean {
  return first(v) === "1";
}

/** 이동 수단 파라미터 — tr=car|transit (그 외는 undefined = 쿠키/기본값) */
export function parseTransport(v: SearchParamValue): "car" | "transit" | undefined {
  const s = first(v);
  return s === "car" || s === "transit" ? s : undefined;
}

/** 위험 유형 필터 — RISK_TYPE_META에 있는 키만 허용 (general·오류는 전체) */
export function parseRiskType(
  v: SearchParamValue,
): Exclude<RiskTypeKey, "general"> | undefined {
  const s = first(v);
  return s && s in RISK_TYPE_META
    ? (s as Exclude<RiskTypeKey, "general">)
    : undefined;
}

/**
 * 날짜 파라미터 파싱 — YYYY-MM-DD, 내일~1년 이내만 허용.
 * 오늘·과거·형식 오류는 undefined (= 오늘 모드, 기존 동작).
 */
export function parseDate(v: SearchParamValue): string | undefined {
  const s = first(v);
  if (!s || !isValidISODate(s)) return undefined;
  const off = dayOffsetSeoul(s);
  return off >= 1 && off <= 366 ? s : undefined;
}

/**
 * 최대 선택 기간(일). 국내여행 평균 체류 2~3일(문체부 국민여행조사)을
 * 넉넉히 커버하는 2주 — 기간 점수는 일자별 계산 N회라 성능·달력 범위밴드
 * 가독성 상한. 설계값.
 */
export const MAX_RANGE_DAYS = 14;

/**
 * 기간 파라미터 파싱 (?date=시작&end=종료).
 * - start가 없으면 end는 무시 (= 오늘 모드, 기존과 동일)
 * - end가 무효이거나 start 이하이면 단일 날짜 모드 ({start}만)
 * - 기간이 MAX_RANGE_DAYS를 넘으면 end를 start+13일로 잘라낸다
 *   (시작일 포함 14일 — URL 수기 조작에도 상한을 보장)
 */
export function parseDateRange(
  dateV: SearchParamValue,
  endV: SearchParamValue,
): { start?: string; end?: string } {
  const start = parseDate(dateV);
  if (!start) return {};
  const end = parseDate(endV);
  if (!end || end <= start) return { start };
  if (nightsBetween(start, end) + 1 > MAX_RANGE_DAYS) {
    return { start, end: addDaysISO(start, MAX_RANGE_DAYS - 1) };
  }
  return { start, end };
}
