/**
 * N박 코스 빌더 테스트. 좌표 참고: 위도 0.1도 ≈ 11.1km.
 */
import { describe, expect, it } from "vitest";
import type { PlaceWithSafety } from "@/lib/datasource";
import type { RiskBreakdown, RiskLevel } from "@/lib/safety/types";
import { buildMultiDayCourse } from "@/lib/course/multi-day";
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

describe("buildMultiDayCourse", () => {
  it("일차별 스톱 + 밤 숙소를 구성하고, 2일차 앵커는 숙소 근처에서 뽑는다", () => {
    const anchor1 = make({ title: "1일차 앵커", safety: makeSafety(95) });
    const lunch1 = make({ contentTypeId: 39, title: "점심1", lat: 37.82 });
    const afternoon1 = make({ contentTypeId: 14, title: "오후1", lat: 37.85, envType: "indoor" });
    // 숙소: 오후1(37.85) 근처
    const lodging = make({ contentTypeId: 32, title: "호텔", lat: 37.86, envType: "indoor" });
    // 2일차 앵커 후보: 숙소 근처(37.9, 다른 시군) vs 같은 점수지만 반경 밖(37.3, ~62km)
    // 1일차 오후 반경(점심 37.82 기준 15km) 밖 + 숙소(37.86) 반경 25km 안 = 37.99
    const near2 = make({ title: "숙소 근처 앵커", sigunguCode: 99, lat: 37.99, safety: makeSafety(90) });
    const far2 = make({ title: "먼 앵커", lat: 37.3, safety: makeSafety(90) });
    const lunch2 = make({ contentTypeId: 39, title: "점심2", lat: 37.9, lng: 128.02 });

    const all = [anchor1, lunch1, afternoon1, near2, far2, lunch2];
    const course = buildMultiDayCourse("nature", SIGUNGU, [all, all], [[lodging], []]);

    expect(course).not.toBeNull();
    expect(course!.days).toHaveLength(2);
    expect(course!.days[0].stops.map((s) => s.place.title)).toEqual([
      "1일차 앵커",
      "점심1",
      "오후1",
    ]);
    expect(course!.days[0].lodging?.place.title).toBe("호텔");
    // 2일차: 반경 25km 내 후보(숙소 근처)가 시군 내 고점(62km 밖)보다 우선
    expect(course!.days[1].stops[0].place.title).toBe("숙소 근처 앵커");
    // 이미 쓴 스톱은 재사용하지 않는다
    const ids = course!.days.flatMap((d) => [
      ...d.stops.map((s) => s.place.contentId),
      ...(d.lodging ? [d.lodging.place.contentId] : []),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("숙소가 반경 내 없으면 그 밤은 숙소 없이 다음 날로 이어간다", () => {
    const anchor1 = make({ title: "앵커1", safety: makeSafety(95) });
    const lunch1 = make({ contentTypeId: 39, title: "점심1", lat: 37.82 });
    // 오후 반경(점심 기준 15km) 밖 + 다음날 앵커 반경(마지막 스톱 기준 25km) 안 = 약 20km
    const anchor2 = make({ title: "앵커2", lat: 38.0, safety: makeSafety(90) });
    const farLodging = make({ contentTypeId: 32, title: "먼 호텔", lat: 39.0, envType: "indoor" });

    const all = [anchor1, lunch1, anchor2];
    const course = buildMultiDayCourse("nature", SIGUNGU, [all, all], [[farLodging], []]);
    expect(course!.days[0].lodging).toBeUndefined();
    expect(course!.days[1].stops[0].place.title).toBe("앵커2");
  });

  it("안전점수 60 미만 숙소는 제외한다", () => {
    const anchor1 = make({ title: "앵커1", safety: makeSafety(95) });
    const lunch1 = make({ contentTypeId: 39, title: "점심1", lat: 37.82 });
    const anchor2 = make({ title: "앵커2", lat: 37.83 });
    const risky = make({ contentTypeId: 32, title: "위험 숙소", lat: 37.83, safety: makeSafety(50) });
    const safe = make({ contentTypeId: 32, title: "안전 숙소", lat: 37.9, safety: makeSafety(80) });

    const all = [anchor1, lunch1, anchor2];
    const course = buildMultiDayCourse("nature", SIGUNGU, [all, all], [[risky, safe], []]);
    expect(course!.days[0].lodging?.place.title).toBe("안전 숙소");
  });

  it("1일차 앵커가 없으면 null", () => {
    const onlyRestaurant = make({ contentTypeId: 39 });
    expect(buildMultiDayCourse("nature", SIGUNGU, [[onlyRestaurant]], [[]])).toBeNull();
  });

  it("자차 배율: 점심 11.1km가 포함된다 (기본 반경에선 스톱 부족으로 null)", () => {
    const anchor = make({ title: "앵커", safety: makeSafety(95) });
    const lunch11 = make({ contentTypeId: 39, title: "점심11", lat: 37.9 }); // +0.1도 ≈ 11.1km
    const all = [anchor, lunch11];

    expect(buildMultiDayCourse("nature", SIGUNGU, [all], [[]])).toBeNull();

    const car = buildMultiDayCourse(
      "nature",
      SIGUNGU,
      [all],
      [[]],
      CAR_COURSE_RADIUS_SCALE,
    );
    expect(car!.days[0].stops.map((s) => s.slot)).toEqual(["morning", "lunch"]);
  });

  it("자차 배율이어도 숙소 반경(15km)은 확대되지 않는다", () => {
    const anchor = make({ title: "앵커", safety: makeSafety(95) });
    const lunch = make({ contentTypeId: 39, title: "점심", lat: 37.82 });
    // 마지막 스톱(오후로 뽑히는 37.85) 기준 +0.15도 ≈ 16.7km — 반경 15km 밖
    const farLodging = make({
      contentTypeId: 32,
      title: "먼 호텔",
      lat: 38.0,
      envType: "indoor",
    });
    const day2anchor = make({
      title: "2일차 앵커",
      lat: 37.85,
      sigunguCode: 99,
      safety: makeSafety(90),
    });
    const all = [anchor, lunch, day2anchor];

    const car = buildMultiDayCourse(
      "nature",
      SIGUNGU,
      [all, all],
      [[farLodging], []],
      CAR_COURSE_RADIUS_SCALE,
    );
    expect(car).not.toBeNull();
    expect(car!.days[0].lodging).toBeUndefined();
  });
});
