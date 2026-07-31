import { describe, expect, it } from "vitest";
import { availableSortKeys, relevanceTier, sortPlaces } from "@/lib/places-sort";

const place = (
  contentId: number,
  title: string,
  score: number,
  addr = "강원특별자치도 어딘가",
) => ({ contentId, title, addr, safety: { score } });

describe("relevanceTier", () => {
  it("제목 완전일치 > 시작 > 포함 > 주소 일치", () => {
    expect(relevanceTier({ title: "설악산", addr: "" }, "설악산")).toBe(3);
    expect(relevanceTier({ title: "설악산 케이블카", addr: "" }, "설악산")).toBe(2);
    expect(relevanceTier({ title: "국립 설악산", addr: "" }, "설악산")).toBe(1);
    expect(
      relevanceTier({ title: "무슨 식당", addr: "속초 설악산로 1" }, "설악산"),
    ).toBe(0);
  });
});

describe("sortPlaces", () => {
  const items = [
    place(1, "국립 설악산", 50),
    place(2, "설악산", 60),
    place(3, "설악산 케이블카", 90),
    place(4, "무슨 식당", 95, "속초 설악산로 1"),
  ];

  it("safety: 안전점수 내림차순", () => {
    expect(sortPlaces(items, "safety", "").map((p) => p.contentId)).toEqual([
      4, 3, 2, 1,
    ]);
  });

  it("relevance: 일치 강도 순, 동점은 안전점수순", () => {
    expect(
      sortPlaces(items, "relevance", "설악산").map((p) => p.contentId),
    ).toEqual([2, 3, 1, 4]);
  });

  it("relevance인데 검색어가 없으면 safety로 폴백", () => {
    expect(sortPlaces(items, "relevance", "").map((p) => p.contentId)).toEqual(
      sortPlaces(items, "safety", "").map((p) => p.contentId),
    );
  });

  it("popularity: 입장객수 내림차순, 미매칭은 뒤에서 안전점수순", () => {
    const visitors = new Map([
      [1, 10_000],
      [2, 500_000],
    ]);
    expect(
      sortPlaces(items, "popularity", "", (id) => visitors.get(id)).map(
        (p) => p.contentId,
      ),
    ).toEqual([2, 1, 4, 3]);
  });

  it("원본 배열을 변경하지 않는다", () => {
    const before = items.map((p) => p.contentId);
    sortPlaces(items, "safety", "");
    expect(items.map((p) => p.contentId)).toEqual(before);
  });
});

describe("availableSortKeys", () => {
  it("검색어·입장객 데이터가 모두 있으면 세 옵션", () => {
    expect(availableSortKeys(true, true)).toEqual([
      "safety",
      "relevance",
      "popularity",
    ]);
  });

  it("검색어가 없으면 정확도순을 감춘다", () => {
    expect(availableSortKeys(false, true)).toEqual(["safety", "popularity"]);
  });

  it("입장객 데이터가 없으면 인기순을 감춘다 — 안전점수순과 결과가 같다", () => {
    expect(availableSortKeys(true, false)).toEqual(["safety", "relevance"]);
    expect(availableSortKeys(false, false)).toEqual(["safety"]);
  });
});
