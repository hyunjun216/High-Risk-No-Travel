import { describe, expect, it } from "vitest";
import { choseongOf, isChoseongQuery, normalize } from "@/lib/search/normalize";

describe("normalize", () => {
  it("공백을 모두 제거해 '남이 섬'과 '남이섬'을 같게 만든다", () => {
    expect(normalize("남이 섬")).toBe(normalize("남이섬"));
  });

  it("구두점·괄호를 제거한다", () => {
    expect(normalize("보광사(속초)")).toBe("보광사속초");
  });

  it("영문은 소문자로 통일한다", () => {
    expect(normalize("Nami")).toBe("nami");
  });

  it("자모 분해(NFD)된 한글을 합쳐 조합형과 같게 만든다", () => {
    expect(normalize("설악산".normalize("NFD"))).toBe("설악산");
  });

  it("전각 문자를 반각으로 정규화한다", () => {
    expect(normalize("ＡＢ１")).toBe("ab1");
  });

  it("숫자와 한글은 보존한다", () => {
    expect(normalize("대진1리해변")).toBe("대진1리해변");
  });
});

describe("choseongOf", () => {
  it("한글 음절에서 초성만 뽑는다", () => {
    expect(choseongOf("정동진")).toBe("ㅈㄷㅈ");
  });

  it("쌍자음 초성을 그대로 낸다", () => {
    expect(choseongOf("꽃밭")).toBe("ㄲㅂ");
  });

  it("한글이 아닌 문자는 그대로 남긴다", () => {
    expect(choseongOf("n서울")).toBe("nㅅㅇ");
  });
});

describe("isChoseongQuery", () => {
  it("자음만 입력하면 초성 질의로 판단한다", () => {
    expect(isChoseongQuery("ㅈㄷㅈ")).toBe(true);
  });

  it("완성된 음절이 섞이면 초성 질의가 아니다", () => {
    expect(isChoseongQuery("ㅈ동진")).toBe(false);
  });

  it("모음만 입력한 것은 초성 질의가 아니다", () => {
    expect(isChoseongQuery("ㅏㅑ")).toBe(false);
  });

  it("빈 문자열은 초성 질의가 아니다", () => {
    expect(isChoseongQuery("")).toBe(false);
  });
});
