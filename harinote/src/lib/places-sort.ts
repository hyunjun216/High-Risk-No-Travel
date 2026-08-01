/**
 * /places 목록 정렬 — URL ?sort= 파라미터별 비교 규칙 (순수 함수).
 *
 * - safety(기본): 안전점수 높은 순 — "어디가 안전한가"가 서비스의 축
 * - relevance: 검색 점수(lib/search)와 안전점수를 섞은 결합 점수 순
 * - popularity: 입장객수(lib/visitors.ts 실데이터) 많은 순, 미매칭은 뒤로
 *
 * 모든 정렬의 동점 처리는 안전점수순 — 목록의 기준 축을 유지한다.
 */
import { hasVisitorData, visitorCount } from "@/lib/visitors";

export type SortKey = "safety" | "relevance" | "popularity";

export const SORT_LABEL: Record<SortKey, string> = {
  safety: "안전점수순",
  relevance: "정확도순",
  popularity: "인기순",
};

/**
 * 드롭다운에 노출할 정렬 옵션 — 결과가 안전점수순과 똑같아지는 옵션은 감춘다.
 * - relevance: 검색어가 없으면 섞을 검색 점수가 없다
 * - popularity: 입장객 통계가 전건 미매칭이면 모두 동점이 되어 안전점수순과 동일하다
 * hasVisitors는 테스트 주입용 (sortPlaces의 getVisitors와 같은 규칙).
 */
export function availableSortKeys(
  hasQuery: boolean,
  hasVisitors: boolean = hasVisitorData(),
): SortKey[] {
  return (Object.keys(SORT_LABEL) as SortKey[]).filter(
    (k) =>
      (k !== "relevance" || hasQuery) && (k !== "popularity" || hasVisitors),
  );
}

interface SortablePlace {
  contentId: number;
  title: string;
  addr: string;
  safety: { score: number };
}

/**
 * 결합 점수의 배분 — 검색어를 친 사용자에게는 "얼마나 맞는가"가 먼저지만,
 * 비슷하게 맞는 곳들 사이에서는 더 안전한 쪽이 위로 오게 한다.
 * 이 서비스에서 검색과 안전점수가 만나는 유일한 지점.
 */
const RELEVANCE_WEIGHT = 0.75;
const SAFETY_WEIGHT = 0.25;

/**
 * 검색 점수와 안전점수를 0~1로 맞춰 섞는다.
 * BM25 점수는 상한이 없으므로 이번 결과의 최고점으로 나눠 정규화한다.
 */
export function combinedScore(
  relevance: number,
  maxRelevance: number,
  safety: number,
): number {
  return (
    RELEVANCE_WEIGHT * (relevance / maxRelevance) +
    SAFETY_WEIGHT * (safety / 100)
  );
}

/**
 * 정렬된 새 배열을 반환 (원본 불변).
 * relevance는 contentId → 검색 점수 맵을 받는다 (없으면 safety로 폴백).
 * getVisitors는 테스트 주입용.
 */
export function sortPlaces<T extends SortablePlace>(
  places: T[],
  sort: SortKey,
  relevance?: Map<number, number>,
  getVisitors: (contentId: number) => number | undefined = visitorCount,
): T[] {
  const bySafety = (a: T, b: T) => b.safety.score - a.safety.score;

  if (sort === "relevance" && relevance && relevance.size > 0) {
    const max = Math.max(...relevance.values()) || 1;
    const combined = (p: T) =>
      combinedScore(relevance.get(p.contentId) ?? 0, max, p.safety.score);
    return [...places].sort(
      (a, b) => combined(b) - combined(a) || bySafety(a, b),
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

  // safety 기본 — relevance인데 검색 점수가 없으면 안전점수순 폴백 (드롭다운도 옵션 미노출)
  return [...places].sort(bySafety);
}
