import { describe, expect, it } from "vitest";
import {
  MAX_RANGE_DAYS,
  parseDateRange,
  parsePlaceType,
  parseSigunguList,
  placeTypeToQuery,
  sigunguParam,
  sigunguSummaryLabel,
} from "@/components/search-params";
import { CAT3_CAFE } from "@/lib/tour/types";
import { addDaysISO, todayISOSeoul } from "@/lib/date";

describe("parseSigunguList", () => {
  it("단일값(레거시 sigungu=N)은 한 원소 배열", () => {
    expect(parseSigunguList("1")).toEqual([1]);
    expect(parseSigunguList("18")).toEqual([18]);
  });

  it("콤마 구분 복수값 파싱", () => {
    expect(parseSigunguList("1,5")).toEqual([1, 5]);
  });

  it("오름차순 정렬 + 중복 제거 (URL 정규형)", () => {
    expect(parseSigunguList("5,1")).toEqual([1, 5]);
    expect(parseSigunguList("3,3")).toEqual([3]);
  });

  it("범위 밖·비숫자는 걸러내고 유효값만", () => {
    expect(parseSigunguList("0,19,5")).toEqual([5]);
    expect(parseSigunguList("abc,7")).toEqual([7]);
  });

  it("전부 무효이거나 비어 있으면 빈 배열", () => {
    expect(parseSigunguList("abc")).toEqual([]);
    expect(parseSigunguList("")).toEqual([]);
    expect(parseSigunguList(undefined)).toEqual([]);
  });

  it("배열이면 첫 값 기준", () => {
    expect(parseSigunguList(["5,13", "2"])).toEqual([5, 13]);
  });
});

describe("sigunguParam", () => {
  it("빈 목록은 undefined (URL에서 생략)", () => {
    expect(sigunguParam([])).toBeUndefined();
  });

  it("목록은 콤마 문자열", () => {
    expect(sigunguParam([1])).toBe("1");
    expect(sigunguParam([1, 5])).toBe("1,5");
  });
});

describe("sigunguSummaryLabel", () => {
  it("0개는 시군 전체", () => {
    expect(sigunguSummaryLabel([])).toBe("시군 전체");
  });

  it("1개는 풀네임", () => {
    expect(sigunguSummaryLabel([1])).toBe("강릉시");
  });

  it("2개는 시·군 접미사를 뗀 중점 연결", () => {
    // 1=강릉시, 5=속초시
    expect(sigunguSummaryLabel([1, 5])).toBe("강릉·속초");
  });

  it("3개 이상은 앞 2개 + 외 N곳", () => {
    // 6=양구군
    expect(sigunguSummaryLabel([1, 5, 6])).toBe("강릉·속초 외 1곳");
    expect(sigunguSummaryLabel([1, 5, 6, 9])).toBe("강릉·속초 외 2곳");
  });
});

describe("parsePlaceType", () => {
  it('"cafe" 슬러그는 그대로 반환', () => {
    expect(parsePlaceType("cafe")).toBe("cafe");
  });

  it("SUPPORTED 화이트리스트 숫자는 ContentTypeId로 반환", () => {
    expect(parsePlaceType("12")).toBe(12);
    expect(parsePlaceType("14")).toBe(14);
    expect(parsePlaceType("39")).toBe(39);
  });

  it("미지원 숫자·무효 문자열·빈 값은 undefined", () => {
    expect(parsePlaceType("38")).toBeUndefined();
    expect(parsePlaceType("espresso")).toBeUndefined();
    expect(parsePlaceType("")).toBeUndefined();
    expect(parsePlaceType(undefined)).toBeUndefined();
  });

  it("배열이면 첫 값 기준", () => {
    expect(parsePlaceType(["cafe", "12"])).toBe("cafe");
    expect(parsePlaceType(["12", "cafe"])).toBe(12);
  });
});

describe("placeTypeToQuery", () => {
  it('"cafe"는 음식점(39) + 카페 소분류(cat3) 조합', () => {
    expect(placeTypeToQuery("cafe")).toEqual({
      contentTypeId: 39,
      cat3: CAT3_CAFE,
    });
  });

  it("숫자 유형은 contentTypeId만", () => {
    expect(placeTypeToQuery(12)).toEqual({ contentTypeId: 12 });
  });

  it("undefined(전체)는 빈 쿼리", () => {
    expect(placeTypeToQuery(undefined)).toEqual({});
  });
});

describe("parseDateRange", () => {
  /** KST 오늘 기준 +days일의 ISO — parseDate와 같은 기준이라 버퍼 불필요 */
  const isoAfter = (days: number) => addDaysISO(todayISOSeoul(), days);

  it("정상 범위는 {start, end}", () => {
    expect(parseDateRange(isoAfter(7), isoAfter(10))).toEqual({
      start: isoAfter(7),
      end: isoAfter(10),
    });
  });

  it("end 없으면 단일 날짜 (기존 동작과 동일)", () => {
    expect(parseDateRange(isoAfter(7), undefined)).toEqual({
      start: isoAfter(7),
    });
  });

  it("end가 start 이전이거나 같으면 {start}만", () => {
    expect(parseDateRange(isoAfter(7), isoAfter(5))).toEqual({
      start: isoAfter(7),
    });
    expect(parseDateRange(isoAfter(7), isoAfter(7))).toEqual({
      start: isoAfter(7),
    });
  });

  it("MAX_RANGE_DAYS 초과면 end를 start+13일로 clamp", () => {
    expect(parseDateRange(isoAfter(7), isoAfter(7 + 30))).toEqual({
      start: isoAfter(7),
      end: isoAfter(7 + MAX_RANGE_DAYS - 1),
    });
    // 정확히 14일(13박)은 clamp하지 않는다
    expect(parseDateRange(isoAfter(7), isoAfter(7 + 13))).toEqual({
      start: isoAfter(7),
      end: isoAfter(7 + 13),
    });
  });

  it("end 형식 오류는 {start}만", () => {
    expect(parseDateRange(isoAfter(7), "2026-02-31")).toEqual({
      start: isoAfter(7),
    });
    expect(parseDateRange(isoAfter(7), "다음주")).toEqual({
      start: isoAfter(7),
    });
  });

  it("start 없이 end만 있으면 빈 결과 (end 무시)", () => {
    expect(parseDateRange(undefined, isoAfter(10))).toEqual({});
    expect(parseDateRange("2026-02-31", isoAfter(10))).toEqual({});
  });

  it("366일 경계: start는 허용, 그 밖의 end는 버려진다", () => {
    expect(parseDateRange(isoAfter(366), isoAfter(370))).toEqual({
      start: isoAfter(366),
    });
    expect(parseDateRange(isoAfter(367), isoAfter(370))).toEqual({});
  });
});
