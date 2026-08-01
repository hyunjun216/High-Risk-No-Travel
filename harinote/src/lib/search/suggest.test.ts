import { describe, expect, it } from "vitest";
import { suggestCorrection } from "@/lib/search/suggest";

const VOCAB = ["설악산", "케이블카", "경포대", "정동진", "속초"];

describe("suggestCorrection", () => {
  it("한 글자 틀린 검색어를 가장 가까운 말로 고친다", () => {
    expect(suggestCorrection("설앙산", VOCAB)).toBe("설악산");
  });

  it("이미 있는 말이면 고칠 게 없다", () => {
    expect(suggestCorrection("설악산", VOCAB)).toBeNull();
  });

  it("너무 동떨어진 검색어는 억지로 고치지 않는다", () => {
    expect(suggestCorrection("제주도한라산", VOCAB)).toBeNull();
  });

  it("여러 어절이면 틀린 어절만 고친다", () => {
    expect(suggestCorrection("속초 케이볼카", VOCAB)).toBe("속초 케이블카");
  });

  it("두 글자 이상 틀리면 고치지 않는다 — 다른 곳을 추천하게 된다", () => {
    expect(suggestCorrection("설앙삼", VOCAB)).toBeNull();
  });

  it("빈 검색어는 제안이 없다", () => {
    expect(suggestCorrection("  ", VOCAB)).toBeNull();
  });
});
