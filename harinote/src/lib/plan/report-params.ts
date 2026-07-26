/**
 * 계획 리포트 URL 인코딩/파싱 — 계획(localStorage)을 쿼리스트링으로 직렬화해
 * 서버 렌더 리포트(/plans/report)와 링크 공유가 가능하게 한다.
 *
 * 형식: ?s=<contentId>.<day>,<contentId>.<day>&from=YYYY-MM-DD&name=...
 * (profile은 기존 화면들과 같은 ?profile= 파라미터 규칙을 따른다)
 */
import type { TravelPlan } from "@/lib/travel-plan";
import { isValidISODate } from "@/lib/date";

/** 방어 상한 — diagnose-action과 동일 */
export const REPORT_MAX_STOPS = 40;
const MAX_DAY = 14;
const MAX_NAME_LEN = 30;

export interface ReportStop {
  contentId: number;
  day: number;
}

export interface ReportQuery {
  stops: ReportStop[];
  from?: string;
  name?: string;
}

/** 계획 → 리포트 쿼리스트링 (선행 "?" 미포함). 빈 계획이면 빈 문자열 */
export function encodePlanQuery(plan: TravelPlan, name?: string): string {
  if (plan.items.length === 0) return "";
  const params = new URLSearchParams();
  params.set(
    "s",
    plan.items.map((it) => `${it.contentId}.${it.day ?? 1}`).join(","),
  );
  if (plan.from) params.set("from", plan.from);
  if (name) params.set("name", name.slice(0, MAX_NAME_LEN));
  return params.toString();
}

/** 쿼리 값 → 스톱 목록. 형식이 깨진 항목은 버리고, 전부 무효면 null */
export function parseReportQuery(
  s: unknown,
  from: unknown,
  name: unknown,
): ReportQuery | null {
  if (typeof s !== "string" || s.length === 0) return null;
  const stops: ReportStop[] = [];
  for (const token of s.split(",").slice(0, REPORT_MAX_STOPS)) {
    const m = /^(\d{1,10})\.(\d{1,2})$/.exec(token);
    if (!m) continue;
    const contentId = Number(m[1]);
    const day = Number(m[2]);
    if (contentId <= 0 || day < 1 || day > MAX_DAY) continue;
    // 같은 관광지 중복 방어 (계획 자체가 중복 없음 — 손상 URL 대비)
    if (stops.some((st) => st.contentId === contentId)) continue;
    stops.push({ contentId, day });
  }
  if (stops.length === 0) return null;

  return {
    stops,
    from:
      typeof from === "string" && isValidISODate(from) ? from : undefined,
    name:
      typeof name === "string" && name.trim().length > 0
        ? name.trim().slice(0, MAX_NAME_LEN)
        : undefined,
  };
}
