import { describe, expect, it } from "vitest";
import { encodePlanQuery, parseReportQuery } from "@/lib/plan/report-params";
import { EMPTY_PLAN, addItem, setTrip, type PlanItem } from "@/lib/travel-plan";

const A: PlanItem = { contentId: 128788, title: "A", lat: 38, lng: 128 };
const B: PlanItem = { contentId: 2600000, title: "B", lat: 37, lng: 128 };

describe("encodePlanQuery", () => {
  it("스톱·출발일·이름을 쿼리스트링으로", () => {
    const plan = setTrip(addItem(addItem(EMPTY_PLAN, A), B, 2), 1, "2026-08-01");
    const q = new URLSearchParams(encodePlanQuery(plan, "속초 나들이"));
    expect(q.get("s")).toBe("128788.1,2600000.2");
    expect(q.get("from")).toBe("2026-08-01");
    expect(q.get("name")).toBe("속초 나들이");
  });
  it("빈 계획이면 빈 문자열", () => {
    expect(encodePlanQuery(EMPTY_PLAN)).toBe("");
  });
});

describe("parseReportQuery", () => {
  it("인코딩→파싱 왕복", () => {
    const plan = setTrip(addItem(addItem(EMPTY_PLAN, A), B, 2), 1, "2026-08-01");
    const q = new URLSearchParams(encodePlanQuery(plan, "속초"));
    const parsed = parseReportQuery(q.get("s"), q.get("from"), q.get("name"));
    expect(parsed).toEqual({
      stops: [
        { contentId: 128788, day: 1 },
        { contentId: 2600000, day: 2 },
      ],
      from: "2026-08-01",
      name: "속초",
    });
  });
  it("깨진 토큰은 버리고 유효한 것만", () => {
    const parsed = parseReportQuery("abc,128788.1,1.99,128788.1,5.2", "bad", 1);
    expect(parsed).toEqual({
      stops: [
        { contentId: 128788, day: 1 },
        { contentId: 5, day: 2 },
      ],
      from: undefined,
      name: undefined,
    });
  });
  it("전부 무효면 null", () => {
    expect(parseReportQuery("", undefined, undefined)).toBeNull();
    expect(parseReportQuery("x.y,,", undefined, undefined)).toBeNull();
    expect(parseReportQuery(42, undefined, undefined)).toBeNull();
  });
});
