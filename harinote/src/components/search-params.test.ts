import { describe, expect, it } from "vitest";
import {
  buildQuery,
  MAX_RANGE_DAYS,
  pageWindow,
  parseDate,
  parseDateRange,
  parsePlaceType,
  parseSigunguList,
  parseSort,
  placeTypeToQuery,
  sigunguParam,
  sigunguSummaryLabel,
  sortParam,
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

  it('"lodging" 슬러그는 그대로 반환 (숫자 "32"는 계속 거부)', () => {
    expect(parsePlaceType("lodging")).toBe("lodging");
    expect(parsePlaceType("32")).toBeUndefined();
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

  it("음식점(39)은 카페 소분류를 제외한다 — 카페 탭과 완전 분리", () => {
    expect(placeTypeToQuery(39)).toEqual({
      contentTypeId: 39,
      excludeCat3: CAT3_CAFE,
    });
  });

  it("그 외 숫자 유형은 contentTypeId만", () => {
    expect(placeTypeToQuery(12)).toEqual({ contentTypeId: 12 });
  });

  it('"lodging"은 숙박(32)', () => {
    expect(placeTypeToQuery("lodging")).toEqual({ contentTypeId: 32 });
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

describe("parseSort / sortParam", () => {
  it("화이트리스트 값만 허용", () => {
    expect(parseSort("relevance")).toBe("relevance");
    expect(parseSort("popularity")).toBe("popularity");
    expect(parseSort("safety")).toBe("safety");
  });

  it("무효·누락은 기본 safety", () => {
    expect(parseSort("xxx")).toBe("safety");
    expect(parseSort("")).toBe("safety");
    expect(parseSort(undefined)).toBe("safety");
  });

  it("배열이면 첫 값 기준", () => {
    expect(parseSort(["popularity", "relevance"])).toBe("popularity");
  });

  it("sortParam: 기본값 safety는 URL에서 생략", () => {
    expect(sortParam("safety")).toBeUndefined();
    expect(sortParam("popularity")).toBe("popularity");
    expect(sortParam("relevance")).toBe("relevance");
  });

  it("검색어가 있으면 기본값이 정확도순", () => {
    expect(parseSort(undefined, true)).toBe("relevance");
    expect(parseSort("", true)).toBe("relevance");
  });

  it("검색어가 있어도 명시한 정렬이 우선한다", () => {
    expect(parseSort("safety", true)).toBe("safety");
    expect(parseSort("popularity", true)).toBe("popularity");
  });

  it("검색 중에는 safety를 URL에 남겨야 기본값(정확도순)으로 되돌아가지 않는다", () => {
    expect(sortParam("safety", true)).toBe("safety");
    expect(sortParam("relevance", true)).toBeUndefined();
  });
});

describe("pageWindow", () => {
  it("total ≤ max면 전체 페이지", () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(3, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(1, 1)).toEqual([1]);
  });

  it("첫 페이지 근처는 1부터 max개", () => {
    expect(pageWindow(1, 87)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(pageWindow(4, 87)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("중간 페이지는 current를 가운데 둔다", () => {
    expect(pageWindow(50, 87)).toEqual([46, 47, 48, 49, 50, 51, 52, 53, 54, 55]);
  });

  it("마지막 페이지 근처는 끝에서 max개", () => {
    expect(pageWindow(87, 87)).toEqual([78, 79, 80, 81, 82, 83, 84, 85, 86, 87]);
    expect(pageWindow(84, 87)).toEqual([78, 79, 80, 81, 82, 83, 84, 85, 86, 87]);
  });

  it("항상 current를 포함하고 max개를 넘지 않는다", () => {
    for (const [cur, total] of [[1, 5], [2, 20], [11, 11], [7, 100]] as const) {
      const w = pageWindow(cur, total);
      expect(w).toContain(cur);
      expect(w.length).toBeLessThanOrEqual(10);
    }
  });
});

// 날짜 기억(hari_date 쿠키)은 두 계약 위에 서 있다. 둘 중 하나라도 깨지면
// 고른 날짜를 해제할 수 없거나(잠김) 지난 날짜가 되살아난다.
describe("날짜 기억이 의존하는 parseDate 계약", () => {
  const today = todayISOSeoul();

  it("오늘은 거부된다 → 해제 칩이 오늘을 실어 보내면 오늘 모드가 된다", () => {
    expect(parseDate(today)).toBeUndefined();
  });

  it("오늘을 명시하면 기간도 함께 풀린다 (start 없으면 end 무시)", () => {
    expect(parseDateRange(today, addDaysISO(today, 3))).toEqual({});
  });

  it("지난 날짜는 거부된다 → 묵은 쿠키가 되살아나지 않는다", () => {
    expect(parseDate(addDaysISO(today, -1))).toBeUndefined();
    expect(parseDate(addDaysISO(today, -400))).toBeUndefined();
  });

  it("미래 날짜만 통과한다 → 기억할 값은 이것뿐", () => {
    expect(parseDate(addDaysISO(today, 1))).toBe(addDaysISO(today, 1));
    expect(parseDate(addDaysISO(today, 366))).toBe(addDaysISO(today, 366));
    expect(parseDate(addDaysISO(today, 367))).toBeUndefined();
  });

  it("쿠키에서 온 쓰레기값도 같은 관문에서 걸린다", () => {
    for (const junk of ["", "오늘", "2026-13-45", "undefined", "null"]) {
      expect(parseDate(junk)).toBeUndefined();
    }
  });
});

// 검색어는 시군·동행처럼 "해제할 수 있는 필터"여야 한다.
// 헤더 검색창은 layout에서 렌더되어 searchParams를 못 읽으므로 항상 빈칸이고,
// 해제 링크가 없으면 사용자가 검색어를 되돌릴 방법이 화면에 남지 않는다.
describe("검색어 해제 링크 — q만 빼고 나머지 조건 보존", () => {
  const current = {
    q: "남이섬",
    type: 12,
    sigungu: "1,5",
    profile: "kids",
    date: "2026-08-15",
    end: "2026-08-17",
    pet: "1",
    tr: "car",
    sort: "popularity",
  };

  it("q를 undefined로 덮으면 쿼리에서 사라진다", () => {
    expect(buildQuery({ ...current, q: undefined })).not.toContain("q=");
  });

  it("나머지 여행 조건은 그대로 살아남는다", () => {
    const qs = buildQuery({ ...current, q: undefined });
    for (const [k, v] of Object.entries(current)) {
      if (k === "q") continue;
      expect(qs).toContain(`${k}=${encodeURIComponent(v)}`);
    }
  });

  it("검색어만 있던 경우엔 조건 없는 목록으로 돌아간다", () => {
    expect(buildQuery({ q: undefined })).toBe("");
  });

  it("빈 문자열도 생략된다 (q=만 남는 URL을 만들지 않는다)", () => {
    expect(buildQuery({ ...current, q: "" })).not.toContain("q=");
  });
});
