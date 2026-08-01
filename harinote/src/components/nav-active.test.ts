import { describe, expect, it } from "vitest";
import { activeTab, isOwnSearchRoute } from "./nav-active";

describe("activeTab", () => {
  it.each([
    ["/", "map"],
    ["/map", "map"],
    ["/places", "places"],
    ["/places/12345", "places"],
    ["/places/12345/report", "places"],
    ["/plans", "plans"],
    ["/unknown", null],
  ] as const)("%s → %s", (pathname, expected) => {
    expect(activeTab(pathname)).toBe(expected);
  });
});

// 헤더 검색창은 여행 조건을 hidden으로 실을 수 없다(layout은 searchParams를 못 읽음).
// 목록에서만 감추고, 자체 검색창이 없는 화면에서는 반드시 남아야 한다.
describe("isOwnSearchRoute", () => {
  it("목록(/places)은 자체 검색창을 가진다 → 헤더 검색 숨김", () => {
    expect(isOwnSearchRoute("/places")).toBe(true);
  });

  it.each(["/places/125798", "/places/125798/report", "/", "/map", "/plans", "/plans/report"])(
    "%s는 헤더 검색이 유일한 검색 경로 → 남긴다",
    (pathname) => {
      expect(isOwnSearchRoute(pathname)).toBe(false);
    },
  );
});
