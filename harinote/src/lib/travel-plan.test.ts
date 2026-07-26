import { describe, expect, it } from "vitest";
import {
  addItem,
  addItems,
  dateOfDay,
  EMPTY_PLAN,
  isValidPlan,
  itemsByDay,
  removeItem,
  reorder,
  setItemDay,
  setTrip,
  swapItem,
  totalDays,
  totalDistanceKm,
  type PlanItem,
} from "@/lib/travel-plan";

const A: PlanItem = { contentId: 1, title: "A", lat: 37.75, lng: 128.87 }; // 강릉
const B: PlanItem = { contentId: 2, title: "B", lat: 37.88, lng: 127.73 }; // 춘천
const C: PlanItem = { contentId: 3, title: "C", lat: 38.21, lng: 128.59 }; // 속초

describe("addItem", () => {
  it("뒤에 추가하고 원본을 변경하지 않는다", () => {
    const p = addItem(EMPTY_PLAN, A);
    expect(p.items.map((i) => i.contentId)).toEqual([1]);
    expect(EMPTY_PLAN.items).toEqual([]);
  });
  it("중복 contentId는 무시 (같은 참조 반환)", () => {
    const p = addItem(addItem(EMPTY_PLAN, A), A);
    expect(p.items).toHaveLength(1);
  });
});

describe("addItems", () => {
  it("순서대로 추가", () => {
    const p = addItems(EMPTY_PLAN, [A, B, C]);
    expect(p.items.map((i) => i.contentId)).toEqual([1, 2, 3]);
  });
  it("이미 담긴 contentId는 스킵", () => {
    const p = addItems(addItem(EMPTY_PLAN, B), [A, B, C]);
    expect(p.items.map((i) => i.contentId)).toEqual([2, 1, 3]);
  });
  it("지정 일차로 담김", () => {
    const p = addItems(setTrip(EMPTY_PLAN, 1, "2026-08-01"), [A, C], 2);
    expect(itemsByDay(p)[1].map((i) => i.contentId)).toEqual([1, 3]);
  });
});

describe("removeItem", () => {
  it("해당 항목만 제거", () => {
    const p = addItem(addItem(EMPTY_PLAN, A), B);
    expect(removeItem(p, 1).items.map((i) => i.contentId)).toEqual([2]);
  });
});

describe("reorder", () => {
  const p3 = addItem(addItem(addItem(EMPTY_PLAN, A), B), C);
  it("앞→뒤 이동", () => {
    expect(reorder(p3, 0, 2).items.map((i) => i.contentId)).toEqual([2, 3, 1]);
  });
  it("뒤→앞 이동", () => {
    expect(reorder(p3, 2, 0).items.map((i) => i.contentId)).toEqual([3, 1, 2]);
  });
  it("범위 밖·동일 위치는 원본 유지", () => {
    expect(reorder(p3, 0, 0)).toBe(p3);
    expect(reorder(p3, 5, 0)).toBe(p3);
  });
});

describe("swapItem", () => {
  const D: PlanItem = { contentId: 4, title: "D", lat: 37.3, lng: 128.5 };
  it("같은 자리에서 교체하고 일차를 유지한다", () => {
    const p = setItemDay(addItem(addItem(EMPTY_PLAN, A), B, 2), 2, 2);
    const swapped = swapItem(p, 2, D);
    expect(swapped.items.map((i) => i.contentId)).toEqual([1, 4]);
    expect(swapped.items[1].day).toBe(2);
  });
  it("새 항목이 이미 담겨 있으면 no-op", () => {
    const p = addItem(addItem(EMPTY_PLAN, A), B);
    expect(swapItem(p, 1, B)).toBe(p);
  });
  it("대상이 없으면 no-op", () => {
    const p = addItem(EMPTY_PLAN, A);
    expect(swapItem(p, 99, D)).toBe(p);
  });
});

describe("totalDistanceKm (항목 배열)", () => {
  it("0~1개면 거리 0", () => {
    expect(totalDistanceKm([])).toBe(0);
    expect(totalDistanceKm([A])).toBe(0);
  });
  it("순서대로 이어붙인 거리 (양수, 순서 바뀌면 달라짐)", () => {
    const d1 = totalDistanceKm([A, B, C]);
    const d2 = totalDistanceKm([C, A, B]);
    expect(d1).toBeGreaterThan(0);
    expect(d1).not.toBe(d2);
  });
});

describe("N박 여행 (nights/day)", () => {
  it("setTrip: 박수·시작일 저장, 총일수 = nights+1", () => {
    const p = setTrip(EMPTY_PLAN, 1, "2026-08-01");
    expect(p.nights).toBe(1);
    expect(totalDays(p)).toBe(2);
  });

  it("dateOfDay: 1일차=시작일, 2일차=다음날", () => {
    const p = setTrip(EMPTY_PLAN, 2, "2026-08-01");
    expect(dateOfDay(p, 1)).toBe("2026-08-01");
    expect(dateOfDay(p, 2)).toBe("2026-08-02");
    expect(dateOfDay(p, 3)).toBe("2026-08-03");
  });

  it("addItem에 일차 지정 + itemsByDay 그룹핑", () => {
    let p = setTrip(EMPTY_PLAN, 1, "2026-08-01"); // 2일
    p = addItem(p, A, 1);
    p = addItem(p, B, 2);
    p = addItem(p, C, 1);
    const g = itemsByDay(p);
    expect(g).toHaveLength(2);
    expect(g[0].map((i) => i.contentId)).toEqual([1, 3]);
    expect(g[1].map((i) => i.contentId)).toEqual([2]);
  });

  it("setItemDay: 항목을 다른 일차로 이동", () => {
    let p = setTrip(addItem(EMPTY_PLAN, A, 1), 1, "2026-08-01");
    p = setItemDay(p, 1, 2);
    expect(itemsByDay(p)[1].map((i) => i.contentId)).toEqual([1]);
  });

  it("setTrip 축소 시 기간 밖 항목은 마지막 일차로 당겨짐", () => {
    let p = setTrip(EMPTY_PLAN, 2, "2026-08-01"); // 3일
    p = addItem(p, A, 3);
    p = setTrip(p, 0, "2026-08-01"); // 당일(1일)로 축소
    expect(p.items[0].day).toBe(1);
  });

  it("setTrip 축소 시 범위 밖 activeDay도 마지막 일차로 보정", () => {
    let p = setTrip(EMPTY_PLAN, 2, "2026-08-01"); // 3일
    p = { ...p, activeDay: 3 };
    p = setTrip(p, 0, "2026-08-01"); // 당일로 축소
    expect(p.activeDay).toBe(1);
    // 범위 안이면 유지
    const q = setTrip({ ...EMPTY_PLAN, activeDay: 2 }, 3, "2026-08-01");
    expect(q.activeDay).toBe(2);
  });
});

describe("isValidPlan", () => {
  it("정상 구조 통과, 손상 값 거부", () => {
    expect(isValidPlan({ items: [A] })).toBe(true);
    expect(isValidPlan({ items: [{ contentId: "x" }] })).toBe(false);
    expect(isValidPlan(null)).toBe(false);
    expect(isValidPlan({ items: "nope" })).toBe(false);
  });

  it("nights·activeDay·day 손상 값 거부 — itemsByDay 크래시 방어", () => {
    // nights 음수 → totalDays 0 → groups[-1].push TypeError
    expect(isValidPlan({ items: [A], nights: -1 })).toBe(false);
    expect(isValidPlan({ items: [A], nights: Number.NaN })).toBe(false);
    expect(isValidPlan({ items: [A], nights: 1.5 })).toBe(false);
    expect(isValidPlan({ items: [A], nights: "2" })).toBe(false);
    expect(isValidPlan({ items: [A], activeDay: 0 })).toBe(false);
    expect(isValidPlan({ items: [A], activeDay: "1" })).toBe(false);
    expect(isValidPlan({ items: [{ ...A, day: 0 }] })).toBe(false);
    expect(isValidPlan({ items: [{ ...A, day: 2.5 }] })).toBe(false);
    // 정상 범위는 통과
    expect(isValidPlan({ items: [{ ...A, day: 2 }], nights: 3, activeDay: 1 })).toBe(true);
    expect(isValidPlan({ items: [], nights: 0 })).toBe(true);
  });

  it("손상 계획이 통과하면 itemsByDay가 던진다 (방어가 필요한 이유)", () => {
    // isValidPlan이 걸러주지 않으면 이 호출이 크래시함을 문서화
    expect(() => itemsByDay({ items: [A], nights: -1 })).toThrow();
  });
});
