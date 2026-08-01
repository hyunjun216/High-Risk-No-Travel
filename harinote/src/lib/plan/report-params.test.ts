import { describe, expect, it } from "vitest";
import {
  encodePlanQuery,
  parseReportQuery,
  REPORT_MAX_STOPS,
} from "@/lib/plan/report-params";
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
      truncated: false,
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
      truncated: false,
    });
  });
  // 상한 초과분이 조용히 사라지면 사용자는 리포트를 완전한 것으로 읽는다
  it("상한 초과 시 앞 40곳만 남기고 truncated로 알린다", () => {
    const s = Array.from({ length: 45 }, (_, i) => `${1000 + i}.1`).join(",");
    const parsed = parseReportQuery(s, undefined, undefined);
    expect(parsed?.stops).toHaveLength(REPORT_MAX_STOPS);
    expect(parsed?.truncated).toBe(true);
    expect(parsed?.stops.at(-1)?.contentId).toBe(1000 + REPORT_MAX_STOPS - 1);
  });

  it("정확히 상한이면 잘리지 않는다 (경계)", () => {
    const s = Array.from({ length: REPORT_MAX_STOPS }, (_, i) => `${1000 + i}.1`).join(",");
    expect(parseReportQuery(s, undefined, undefined)?.truncated).toBe(false);
  });

  it("전부 무효면 null", () => {
    expect(parseReportQuery("", undefined, undefined)).toBeNull();
    expect(parseReportQuery("x.y,,", undefined, undefined)).toBeNull();
    expect(parseReportQuery(42, undefined, undefined)).toBeNull();
  });
});

describe("슬롯 코드 (m/l/a/e/n)", () => {
  it("slot 있는 항목은 3토큰으로 인코딩, 없는 항목은 기존 2토큰", () => {
    const plan = setTrip(
      addItem(addItem(EMPTY_PLAN, { ...A, slot: "morning" }), { ...B, slot: "lodging" }, 2),
      1,
      "2026-08-01",
    );
    const q = new URLSearchParams(encodePlanQuery(plan));
    expect(q.get("s")).toBe("128788.1.m,2600000.2.n");
  });

  it("인코딩→파싱 왕복에서 slot 보존", () => {
    const plan = addItem(addItem(EMPTY_PLAN, { ...A, slot: "evening" }), B);
    const q = new URLSearchParams(encodePlanQuery(plan));
    const parsed = parseReportQuery(q.get("s"), undefined, undefined);
    expect(parsed!.stops).toEqual([
      { contentId: 128788, day: 1, slot: "evening" },
      { contentId: 2600000, day: 1, slot: undefined },
    ]);
  });

  it("레거시 URL(슬롯 없음) 하위호환 + 잘못된 슬롯 코드는 토큰째 버림", () => {
    expect(parseReportQuery("128788.1", undefined, undefined)!.stops).toEqual([
      { contentId: 128788, day: 1, slot: undefined },
    ]);
    expect(
      parseReportQuery("128788.1.z,2600000.1.l", undefined, undefined)!.stops,
    ).toEqual([{ contentId: 2600000, day: 1, slot: "lunch" }]);
  });
});
