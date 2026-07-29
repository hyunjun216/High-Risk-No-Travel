/**
 * 빈 슬롯 채우기 엔진 테스트. 좌표 참고: 위도 0.1도 ≈ 11.1km.
 * 앵커 0개 = 기존 N박 추천(multi-day)과 동일 동작 — 그 테스트 케이스를 이관·확장.
 */
import { describe, expect, it } from "vitest";
import type { PlaceWithSafety } from "@/lib/datasource";
import type { RiskBreakdown, RiskLevel } from "@/lib/safety/types";
import { fillPlanSlots, type FillAnchor } from "@/lib/course/fill-slots";
import { CAR_COURSE_RADIUS_SCALE } from "@/lib/course/themed";

const SIGUNGU = 13;

function gradeFor(score: number): RiskLevel {
  return score >= 70 ? "low" : score >= 40 ? "moderate" : "high";
}

function makeSafety(score: number): RiskBreakdown {
  return {
    score,
    grade: gradeFor(score),
    profile: "default",
    factors: [],
    weatherRisk: 0,
    disasterRisk: 0,
    medicalRisk: 0,
  };
}

let nextId = 1;
function make(overrides: Partial<PlaceWithSafety> = {}): PlaceWithSafety {
  return {
    contentId: nextId++,
    contentTypeId: 12,
    title: `장소${nextId}`,
    addr: "강원",
    sigunguCode: SIGUNGU,
    lng: 128.0,
    lat: 37.8,
    envType: "outdoor_general",
    safety: makeSafety(85),
    ...overrides,
  };
}

function anchorOf(p: PlaceWithSafety, slot: FillAnchor["slot"]): FillAnchor {
  return { contentId: p.contentId, slot, lat: p.lat, lng: p.lng };
}

function fillMap(fills: { day: number; slot: string; place: PlaceWithSafety }[]) {
  return new Map(fills.map((f) => [`${f.day}:${f.slot}`, f.place.title]));
}

describe("fillPlanSlots — 앵커 0개 (기존 N박 추천 동작)", () => {
  it("일차별 스톱 + 밤 숙소를 채우고, 2일차 오전은 숙소 근처에서 뽑는다", () => {
    const anchor1 = make({ title: "1일차 앵커", safety: makeSafety(95) });
    const lunch1 = make({ contentTypeId: 39, title: "점심1", lat: 37.82 });
    const afternoon1 = make({ contentTypeId: 14, title: "오후1", lat: 37.85, envType: "indoor" });
    const lodging = make({ contentTypeId: 32, title: "호텔", lat: 37.86, envType: "indoor" });
    // 2일차 오전 후보: 숙소 근처(반경 25km 안) vs 같은 점수지만 반경 밖(~62km)
    const near2 = make({ title: "숙소 근처 앵커", sigunguCode: 99, lat: 37.99, safety: makeSafety(90) });
    const far2 = make({ title: "먼 앵커", lat: 37.3, safety: makeSafety(90) });

    const all = [anchor1, lunch1, afternoon1, near2, far2];
    const fills = fillPlanSlots({
      theme: "nature",
      sigunguCode: SIGUNGU,
      anchorsByDay: [[], []],
      candidatesByDay: [all, all],
      lodgingsByDay: [[lodging], []],
    });

    const m = fillMap(fills);
    expect(m.get("1:morning")).toBe("1일차 앵커");
    expect(m.get("1:lunch")).toBe("점심1");
    expect(m.get("1:afternoon")).toBe("오후1");
    expect(m.get("1:lodging")).toBe("호텔");
    expect(m.get("2:morning")).toBe("숙소 근처 앵커");
    // 마지막 일차엔 숙소를 채우지 않는다
    expect(m.has("2:lodging")).toBe(false);
    // 이미 쓴 스톱은 재사용하지 않는다
    const ids = fills.map((f) => f.place.contentId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("저녁 슬롯: 직전 스톱 반경 10km 음식점(카페 제외)을 채운다", () => {
    const anchor = make({ title: "앵커", safety: makeSafety(95) });
    const lunch = make({ contentTypeId: 39, title: "점심", lat: 37.82 });
    const afternoon = make({ contentTypeId: 14, title: "오후", lat: 37.85, envType: "indoor" });
    const cafe = make({ contentTypeId: 39, title: "카페", lat: 37.85, cat3: "A05020900" });
    const dinner = make({ contentTypeId: 39, title: "저녁집", lat: 37.86 });
    const farDinner = make({ contentTypeId: 39, title: "먼 저녁집", lat: 38.5, safety: makeSafety(99) });

    const all = [anchor, lunch, afternoon, cafe, dinner, farDinner];
    const fills = fillPlanSlots({
      theme: "nature",
      sigunguCode: SIGUNGU,
      anchorsByDay: [[]],
      candidatesByDay: [all],
      lodgingsByDay: [[]],
    });
    expect(fillMap(fills).get("1:evening")).toBe("저녁집");
  });

  it("안전점수 60 미만 숙소는 제외한다", () => {
    const anchor1 = make({ title: "앵커1", safety: makeSafety(95) });
    const lunch1 = make({ contentTypeId: 39, title: "점심1", lat: 37.82 });
    const risky = make({ contentTypeId: 32, title: "위험 숙소", lat: 37.83, safety: makeSafety(50) });
    const safe = make({ contentTypeId: 32, title: "안전 숙소", lat: 37.9, safety: makeSafety(80) });

    const all = [anchor1, lunch1];
    const fills = fillPlanSlots({
      theme: "nature",
      sigunguCode: SIGUNGU,
      anchorsByDay: [[], []],
      candidatesByDay: [all, all],
      lodgingsByDay: [[risky, safe], []],
    });
    expect(fillMap(fills).get("1:lodging")).toBe("안전 숙소");
  });

  it("자차 배율: 점심 11.1km가 포함된다 (기본 반경에선 제외)", () => {
    const anchor = make({ title: "앵커", safety: makeSafety(95) });
    const lunch11 = make({ contentTypeId: 39, title: "점심11", lat: 37.9 });
    const all = [anchor, lunch11];

    const base = fillPlanSlots({
      theme: "nature",
      sigunguCode: SIGUNGU,
      anchorsByDay: [[]],
      candidatesByDay: [all],
      lodgingsByDay: [[]],
    });
    expect(fillMap(base).has("1:lunch")).toBe(false);

    const car = fillPlanSlots({
      theme: "nature",
      sigunguCode: SIGUNGU,
      anchorsByDay: [[]],
      candidatesByDay: [all],
      lodgingsByDay: [[]],
      radiusScale: CAR_COURSE_RADIUS_SCALE,
    });
    expect(fillMap(car).get("1:lunch")).toBe("점심11");
  });
});

describe("fillPlanSlots — 앵커 존중", () => {
  it("앵커가 있는 슬롯은 채우지 않고, 앵커를 기준점으로 빈 슬롯을 채운다", () => {
    const myMorning = make({ title: "내가 담은 오전", lat: 38.2, safety: makeSafety(70) });
    // 앵커(38.2) 근처 음식점 vs 시군 최고점(37.8) 근처 음식점
    const nearAnchor = make({ contentTypeId: 39, title: "앵커 근처 식당", lat: 38.21 });
    const nearTop = make({ contentTypeId: 39, title: "시군탑 근처 식당", lat: 37.81, safety: makeSafety(99) });
    const top = make({ title: "시군 최고점", safety: makeSafety(99) });

    const all = [myMorning, nearAnchor, nearTop, top];
    const fills = fillPlanSlots({
      theme: "nature",
      sigunguCode: SIGUNGU,
      anchorsByDay: [[anchorOf(myMorning, "morning")]],
      candidatesByDay: [all],
      lodgingsByDay: [[]],
    });

    const m = fillMap(fills);
    // 오전은 앵커가 차지 — 채우지 않는다
    expect(m.has("1:morning")).toBe(false);
    // 점심은 앵커 반경 10km 내에서 (시군 최고점 근처가 아니라)
    expect(m.get("1:lunch")).toBe("앵커 근처 식당");
    // 앵커 자신은 결과에 없다
    expect(fills.some((f) => f.place.contentId === myMorning.contentId)).toBe(false);
  });

  it("모든 낮 슬롯이 앵커면 숙소만 채운다", () => {
    const a1 = make({ title: "오전앵커" });
    const a2 = make({ contentTypeId: 39, title: "점심앵커", lat: 37.81 });
    const a3 = make({ contentTypeId: 14, title: "오후앵커", lat: 37.82 });
    const a4 = make({ contentTypeId: 39, title: "저녁앵커", lat: 37.83 });
    const hotel = make({ contentTypeId: 32, title: "호텔", lat: 37.84, envType: "indoor" });
    const spare = make({ title: "여분", safety: makeSafety(99) });

    const all = [a1, a2, a3, a4, spare];
    const fills = fillPlanSlots({
      theme: "nature",
      sigunguCode: SIGUNGU,
      anchorsByDay: [
        [
          anchorOf(a1, "morning"),
          anchorOf(a2, "lunch"),
          anchorOf(a3, "afternoon"),
          anchorOf(a4, "evening"),
        ],
        [],
      ],
      candidatesByDay: [all, all],
      lodgingsByDay: [[hotel], []],
    });

    expect(fills.filter((f) => f.day === 1).map((f) => f.slot)).toEqual(["lodging"]);
    expect(fillMap(fills).get("1:lodging")).toBe("호텔");
  });

  it("앵커로 담은 숙소가 있으면 그 숙소 근처에서 다음 날 오전을 채운다", () => {
    const a1 = make({ title: "오전앵커" });
    const myHotel = make({ contentTypeId: 32, title: "내 숙소", lat: 38.3, envType: "indoor" });
    const nearMyHotel = make({ title: "내숙소 근처", sigunguCode: 99, lat: 38.35, safety: makeSafety(75) });
    const nearDay1 = make({ title: "1일차 근처", lat: 37.81, safety: makeSafety(99) });

    const all = [a1, nearMyHotel, nearDay1];
    const fills = fillPlanSlots({
      theme: "nature",
      sigunguCode: SIGUNGU,
      anchorsByDay: [
        [anchorOf(a1, "morning"), anchorOf(myHotel, "lodging")],
        [],
      ],
      candidatesByDay: [all, all],
      lodgingsByDay: [[], []],
    });

    const m = fillMap(fills);
    // 1일차 숙소는 앵커가 차지 — 채우지 않는다
    expect(m.has("1:lodging")).toBe(false);
    // 2일차 오전은 내 숙소(38.3) 반경 25km 내 — 1일차 근처 고점이 아니라
    expect(m.get("2:morning")).toBe("내숙소 근처");
  });

  it("앵커 contentId는 어느 일차에서도 다시 추천되지 않는다", () => {
    const mine = make({ title: "내가 담은 곳", safety: makeSafety(99) });
    const other = make({ title: "다른 곳", safety: makeSafety(90) });

    const all = [mine, other];
    const fills = fillPlanSlots({
      theme: "nature",
      sigunguCode: SIGUNGU,
      anchorsByDay: [[], [anchorOf(mine, "morning")]],
      candidatesByDay: [all, all],
      lodgingsByDay: [[], []],
    });
    // 1일차 오전은 최고점(내가 담은 곳=2일차 앵커)을 건너뛰고 다른 곳
    expect(fillMap(fills).get("1:morning")).toBe("다른 곳");
  });

  it("대안은 슬롯당 최대 2개, 채운 스톱과 중복되지 않는다", () => {
    const anchor = make({ title: "앵커", safety: makeSafety(95) });
    const r1 = make({ contentTypeId: 39, title: "식당1", lat: 37.81, safety: makeSafety(90) });
    const r2 = make({ contentTypeId: 39, title: "식당2", lat: 37.82, safety: makeSafety(85) });
    const r3 = make({ contentTypeId: 39, title: "식당3", lat: 37.83, safety: makeSafety(80) });
    const r4 = make({ contentTypeId: 39, title: "식당4", lat: 37.84, safety: makeSafety(75) });

    const all = [anchor, r1, r2, r3, r4];
    const fills = fillPlanSlots({
      theme: "nature",
      sigunguCode: SIGUNGU,
      anchorsByDay: [[]],
      candidatesByDay: [all],
      lodgingsByDay: [[]],
    });
    const lunch = fills.find((f) => f.slot === "lunch");
    expect(lunch!.place.title).toBe("식당1");
    expect(lunch!.alternates.map((a) => a.title)).toEqual(["식당2", "식당3"]);
  });
});
