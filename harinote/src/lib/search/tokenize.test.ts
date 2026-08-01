import { describe, expect, it } from "vitest";
import { tokenize } from "@/lib/search/tokenize";

describe("tokenize", () => {
  it("어절 전체를 토큰으로 낸다", () => {
    expect(tokenize("설악산")).toContain("설악산");
  });

  it("두 글자씩 잘라 부분 일치용 토큰을 만든다", () => {
    const terms = tokenize("설악산");
    expect(terms).toContain("설악");
    expect(terms).toContain("악산");
  });

  it("어절 경계를 넘는 조각을 만들어 '남이 섬'이 '남이섬'과 만나게 한다", () => {
    // 띄어쓴 질의에는 '남이섬' 어절이 없다 — 겹치는 bigram이 매칭을 만든다
    expect(tokenize("남이 섬")).toContain("이섬");
    expect(tokenize("남이섬")).toContain("이섬");
  });

  it("여러 어절이면 각 어절을 토큰으로 낸다", () => {
    const terms = tokenize("설악산 케이블카");
    expect(terms).toContain("설악산");
    expect(terms).toContain("케이블카");
  });

  it("한 글자 입력은 그 글자 자체를 토큰으로 낸다", () => {
    expect(tokenize("산")).toEqual(["산"]);
  });

  it("구두점은 정규화 단계에서 사라진다", () => {
    expect(tokenize("보광사(속초)")).toContain("사속");
  });

  it("빈 입력과 공백은 토큰이 없다", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });
});
