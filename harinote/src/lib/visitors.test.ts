import { describe, expect, it } from "vitest";
import { buildVisitorsMap, normalizeTitle } from "@/lib/visitors";

describe("normalizeTitle", () => {
  it("공백·특수문자를 제거하고 소문자로", () => {
    expect(normalizeTitle("설악산 케이블카")).toBe("설악산케이블카");
    expect(normalizeTitle("Arte Museum GANGNEUNG")).toBe("artemuseumgangneung");
    expect(normalizeTitle("낙산사 · 의상대")).toBe("낙산사의상대");
  });

  it("괄호 내용을 제거한다", () => {
    expect(normalizeTitle("소양강스카이워크(춘천)")).toBe("소양강스카이워크");
    expect(normalizeTitle("대관령 하늘목장 (평창)")).toBe("대관령하늘목장");
  });

  it("NFD 분해형 한글도 동일 결과 (NFC 정규화)", () => {
    expect(normalizeTitle("설악산".normalize("NFD"))).toBe("설악산");
  });
});

describe("buildVisitorsMap", () => {
  it("contentId → visitors, 같은 관광지 복수 지점은 합산", () => {
    const map = buildVisitorsMap([
      { contentId: 1, visitors: 100 },
      { contentId: 2, visitors: 50 },
      { contentId: 1, visitors: 30 },
    ]);
    expect(map.get(1)).toBe(130);
    expect(map.get(2)).toBe(50);
  });

  it("손상 데이터는 빈 Map / 무효 레코드는 건너뛴다", () => {
    expect(buildVisitorsMap(null).size).toBe(0);
    expect(buildVisitorsMap("oops").size).toBe(0);
    const map = buildVisitorsMap([
      { contentId: 1, visitors: 0 },
      { contentId: 2, visitors: -5 },
      { contentId: "x", visitors: 10 },
      { contentId: 3, visitors: 10 },
    ]);
    expect([...map.keys()]).toEqual([3]);
  });
});
