import { describe, expect, it } from "vitest";
import {
  getPlaces,
  getRangeSafety,
  pickWorstDay,
  type DateSafety,
} from "@/lib/datasource";
import { CAT3_CAFE } from "@/lib/tour/types";
import type { RiskBreakdown } from "@/lib/safety/types";
import { addDaysISO, monthOfISO, todayISOSeoul } from "@/lib/date";

describe("getPlaces — sigunguCode 필터", () => {
  it("시군구 코드로 필터하면 전건이 해당 코드다 (춘천=13)", async () => {
    const places = await getPlaces({ sigunguCode: 13 });
    expect(places.length).toBeGreaterThan(0);
    expect(places.every((p) => p.sigunguCode === 13)).toBe(true);
  });

  it("검색어와 시군구 필터를 함께 적용할 수 있다", async () => {
    const all = await getPlaces({ q: "해수욕장" });
    const sokcho = await getPlaces({ q: "해수욕장", sigunguCode: 5 });
    expect(sokcho.length).toBeGreaterThan(0);
    expect(sokcho.length).toBeLessThan(all.length);
    expect(sokcho.every((p) => p.sigunguCode === 5)).toBe(true);
  });

  it("sigunguCode 미지정이면 필터하지 않는다", async () => {
    const all = await getPlaces();
    const unfiltered = await getPlaces({ sigunguCode: undefined });
    expect(unfiltered.length).toBe(all.length);
  });
});

describe("getPlaces — cat3 필터", () => {
  it("카페 소분류(cat3)로 필터하면 전건이 해당 소분류의 음식점이다", async () => {
    const cafes = await getPlaces({ contentTypeId: 39, cat3: CAT3_CAFE });
    expect(cafes.length).toBeGreaterThan(0);
    expect(
      cafes.every((p) => p.cat3 === CAT3_CAFE && p.contentTypeId === 39),
    ).toBe(true);
  });

  it("카페는 음식점(39)의 서브셋이다", async () => {
    const restaurants = await getPlaces({ contentTypeId: 39 });
    const cafes = await getPlaces({ contentTypeId: 39, cat3: CAT3_CAFE });
    expect(cafes.length).toBeLessThan(restaurants.length);
  });

  it("cat3 미지정이면 필터하지 않는다", async () => {
    const all = await getPlaces();
    const unfiltered = await getPlaces({ cat3: undefined });
    expect(unfiltered.length).toBe(all.length);
  });
});

// ── 기간 점수 (getRangeSafety · pickWorstDay) ─────────────────────

/** pickWorstDay 테스트용 최소 DateSafety */
function fakeDay(dateISO: string, score: number): DateSafety {
  const breakdown: RiskBreakdown = {
    score,
    grade: "low",
    profile: "default",
    factors: [],
    weatherRisk: 0,
    disasterRisk: 0,
    medicalRisk: 0,
  };
  return { mode: "seasonal", dateISO, dayOffset: 10, breakdown };
}

describe("pickWorstDay", () => {
  it("대표점수가 가장 낮은 날을 고른다", () => {
    const days = [
      fakeDay("2026-07-20", 80),
      fakeDay("2026-07-21", 55),
      fakeDay("2026-07-22", 70),
    ];
    expect(pickWorstDay(days).dateISO).toBe("2026-07-21");
  });

  it("동점이면 빠른 날짜", () => {
    const days = [
      fakeDay("2026-07-20", 60),
      fakeDay("2026-07-21", 55),
      fakeDay("2026-07-22", 55),
    ];
    expect(pickWorstDay(days).dateISO).toBe("2026-07-21");
  });
});

describe("getRangeSafety", () => {
  it("먼 미래(순수 seasonal) 범위 — days 길이·worst 일관성", async () => {
    const [place] = await getPlaces({ sigunguCode: 13 });
    const start = addDaysISO(todayISOSeoul(), 30);
    const end = addDaysISO(start, 3);

    const range = await getRangeSafety(place, "default", start, end);
    expect(range).not.toBeNull();
    expect(range!.days).toHaveLength(4);
    expect(range!.nights).toBe(3);
    expect(range!.days.every((d) => d.mode === "seasonal")).toBe(true);
    // worst는 days 중 최저 대표점수와 일치한다
    const minScore = Math.min(...range!.days.map((d) => d.breakdown.score));
    expect(range!.worst.breakdown.score).toBe(minScore);
    expect(range!.days).toContain(range!.worst);
  });

  it("월 경계 범위 — 두 달의 계절 시나리오가 각각 반영된다", async () => {
    const [place] = await getPlaces({ sigunguCode: 13 });
    // 먼 미래(D+10~)에서 3일 뒤에 달이 바뀌는 시작일을 찾는다
    let start = addDaysISO(todayISOSeoul(), 10);
    while (monthOfISO(start) === monthOfISO(addDaysISO(start, 3))) {
      start = addDaysISO(start, 1);
    }
    const end = addDaysISO(start, 3);

    const range = await getRangeSafety(place, "default", start, end);
    expect(range).not.toBeNull();
    expect(range!.days).toHaveLength(4);
    const first = range!.days[0];
    const last = range!.days[range!.days.length - 1];
    expect(first.seasonal?.month).toBe(monthOfISO(start));
    expect(last.seasonal?.month).toBe(monthOfISO(end));
    expect(first.seasonal?.month).not.toBe(last.seasonal?.month);
  });
});
