/**
 * /places 목록 정렬 — URL ?sort= 파라미터별 비교 규칙 (순수 함수).
 *
 * - safety(기본): 안전점수 높은 순 — "어디가 안전한가"가 서비스의 축
 * - relevance: 검색어 일치 강도 순 (검색어 없으면 safety로 폴백)
 * - popularity: 입장객수(lib/visitors.ts 실데이터) 많은 순, 미매칭은 뒤로
 *
 * 모든 정렬의 동점 처리는 안전점수순 — 목록의 기준 축을 유지한다.
 */
import { visitorCount } from "@/lib/visitors";

export type SortKey = "safety" | "relevance" | "popularity";

export const SORT_LABEL: Record<SortKey, string> = {
  safety: "안전점수순",
  relevance: "정확도순",
  popularity: "인기순",
};

interface SortablePlace {
  contentId: number;
  title: string;
  addr: string;
  safety: { score: number };
}

/**
 * 검색어 일치 강도 — matchesPlaceQuery(title/addr 포함 일치)로 이미 걸러진
 * 결과에만 서열을 매긴다: 제목 완전일치 > 제목 시작 > 제목 포함 > 주소 포함.
 */
export function relevanceTier(
  p: { title: string; addr: string },
  q: string,
): number {
  if (p.title === q) return 3;
  if (p.title.startsWith(q)) return 2;
  if (p.title.includes(q)) return 1;
  return 0;
}

/** 정렬된 새 배열을 반환 (원본 불변). getVisitors는 테스트 주입용. */
export function sortPlaces<T extends SortablePlace>(
  places: T[],
  sort: SortKey,
  q: string,
  getVisitors: (contentId: number) => number | undefined = visitorCount,
): T[] {
  const bySafety = (a: T, b: T) => b.safety.score - a.safety.score;
  if (sort === "relevance" && q) {
    return [...places].sort(
      (a, b) => relevanceTier(b, q) - relevanceTier(a, q) || bySafety(a, b),
    );
  }
  if (sort === "popularity") {
    // 미매칭(undefined)은 -1로 취급해 매칭 0건 구간 전체가 뒤로 밀린다
    return [...places].sort(
      (a, b) =>
        (getVisitors(b.contentId) ?? -1) - (getVisitors(a.contentId) ?? -1) ||
        bySafety(a, b),
    );
  }
  // safety 기본 — relevance인데 검색어가 없으면 안전점수순 폴백 (드롭다운도 옵션 미노출)
  return [...places].sort(bySafety);
}
