/** 헤더 탭 활성 판정 — usePathname() 결과(쿼리 제외 경로)를 받는다 */
export type TabKey = "map" | "places" | "plans";

export function activeTab(pathname: string): TabKey | null {
  if (pathname === "/" || pathname === "/map") return "map";
  if (pathname === "/places" || pathname.startsWith("/places/")) return "places";
  if (pathname === "/plans" || pathname.startsWith("/plans/")) return "plans";
  return null;
}

/**
 * 화면이 여행 조건을 아는 자체 검색창을 갖는가 — 헤더 전역 검색을 감출 판정.
 * 목록(/places)만 해당한다. 상세(/places/123)는 자체 검색창이 없어 헤더가 유일한
 * 검색 경로이므로 감추면 안 된다.
 */
export function isOwnSearchRoute(pathname: string): boolean {
  return pathname === "/places";
}
