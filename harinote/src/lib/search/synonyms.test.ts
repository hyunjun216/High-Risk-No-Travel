import { describe, expect, it } from "vitest";
import { queryVariants } from "@/lib/search/synonyms";

describe("queryVariants", () => {
  it("원래 검색어가 항상 첫 번째다", () => {
    expect(queryVariants("해변")[0]).toBe("해변");
  });

  it("해변으로 검색하면 해수욕장 변형도 만든다", () => {
    expect(queryVariants("해변")).toContain("해수욕장");
  });

  it("반대 방향도 성립한다", () => {
    expect(queryVariants("해수욕장")).toContain("해변");
  });

  it("사전에 없는 단어는 변형이 없다", () => {
    expect(queryVariants("설악산")).toEqual(["설악산"]);
  });

  it("어절 하나만 바꾼 변형을 만들어 나머지 문맥을 유지한다", () => {
    expect(queryVariants("속초 펜션")).toContain("속초 숙소");
  });

  it("동의어를 한꺼번에 이어붙이지 않는다 — 변형마다 따로 검색하기 위함", () => {
    expect(queryVariants("해변")).not.toContain("해변 해수욕장 비치 바닷가");
  });

  it("빈 검색어는 변형이 없다", () => {
    expect(queryVariants("   ")).toEqual([]);
  });
});
