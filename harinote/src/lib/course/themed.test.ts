/**
 * 테마별 안전 코스 3선 테스트.
 * 좌표 참고: 위도 0.1도 ≈ 11.1km — 앵커(37.8, 128.0) 기준
 * +0.08도 ≈ 8.9km(점심 10km 이내), +0.1도 ≈ 11.1km(10km 초과),
 * +0.13도 ≈ 14.5km(오후 15km 이내), +0.15도 ≈ 16.7km(15km 초과).
 */
import { describe, expect, it } from "vitest";
import type { PlaceWithSafety } from "@/lib/datasource";
import type { RiskBreakdown, RiskFactor, RiskFactorKey, RiskLevel } from "@/lib/safety/types";
import {
  buildThemedCourses,
  CAR_COURSE_RADIUS_SCALE,
} from "@/lib/course/themed";
import { CAT3_CAFE } from "@/lib/tour/types";

const SIGUNGU = 13; // 춘천시

function gradeFor(score: number): RiskLevel {
  if (score >= 70) return "low";
  if (score >= 40) return "moderate";
  return "high";
}

/** 감점을 층에 실어 주는 요인 mock — meetsCourseSafety가 factors를 읽는다 */
function mockFactor(key: RiskFactorKey, points: number): RiskFactor {
  return {
    key, label: key, value: 0, unit: "", threshold: 0,
    points, maxPoints: 80, level: "low", description: "",
  };
}

function makeSafety(score: number, weatherRisk = 0): RiskBreakdown {
  // 코스 자격(meetsCourseSafety)은 총점이 아니라 factors의 안전층 합을 본다.
  // 총 감점에서 weatherRisk(쾌적)를 뺀 나머지를 안전층에 실어 기존 의도를 유지한다
  // — score 59면 안전 41점이 되어 컷(100−60=40)을 넘어 그대로 탈락한다.
  const safetyPts = Math.max(0, 100 - score - weatherRisk);
  return {
    score,
    grade: gradeFor(score),
    profile: "default",
    factors: [
      ...(weatherRisk > 0 ? [mockFactor("rain", weatherRisk)] : []),
      ...(safetyPts > 0 ? [mockFactor("forest_fire", safetyPts)] : []),
    ],
    weatherRisk,
    disasterRisk: safetyPts,
    medicalRisk: 0,
  };
}

let nextId = 1;

function makePlace(overrides: Partial<PlaceWithSafety> = {}): PlaceWithSafety {
  return {
    contentId: nextId++,
    contentTypeId: 12,
    title: "테스트 관광지",
    addr: "강원특별자치도",
    sigunguCode: SIGUNGU,
    lng: 128.0,
    lat: 37.8,
    envType: "outdoor_general",
    safety: makeSafety(80),
    ...overrides,
  };
}

function makeRestaurant(
  overrides: Partial<PlaceWithSafety> = {},
): PlaceWithSafety {
  return makePlace({ contentTypeId: 39, title: "테스트 음식점", ...overrides });
}

/**
 * 3테마 모두에 점심·오후가 붙을 수 있는 기본 후보 (앵커 반경 내).
 * 오후 후보는 이웃 시군 소속 — 앵커 선정에 끼어들지 않으면서 반경 허용을 검증.
 */
function baseSupport(): PlaceWithSafety[] {
  return [
    makeRestaurant({ lat: 37.88 }), // 점심 8.9km
    makePlace({ lat: 37.88, sigunguCode: 1, safety: makeSafety(75) }), // 오후 후보
  ];
}

describe("buildThemedCourses — 테마별 앵커 매칭", () => {
  it("nature: 시군 내 야외·산악 관광지 중 안전점수 최고를 앵커로", () => {
    const worse = makePlace({ envType: "outdoor_mountain", safety: makeSafety(70) });
    const best = makePlace({ envType: "outdoor_general", safety: makeSafety(90) });
    const notNature = makePlace({ envType: "outdoor_coast", safety: makeSafety(95) });
    const courses = buildThemedCourses(SIGUNGU, [
      worse,
      best,
      notNature,
      ...baseSupport(),
    ]);
    expect(courses.nature).not.toBeNull();
    expect(courses.nature!.stops[0].place.contentId).toBe(best.contentId);
  });

  it("water: 해안·수변 장소를 앵커로, culture: 실내 또는 문화시설(14)을 앵커로", () => {
    const coast = makePlace({ envType: "outdoor_coast" });
    const museum = makePlace({
      contentTypeId: 14,
      envType: "indoor",
      safety: makeSafety(85),
    });
    const courses = buildThemedCourses(SIGUNGU, [
      coast,
      museum,
      ...baseSupport(),
    ]);
    expect(courses.water!.stops[0].place.contentId).toBe(coast.contentId);
    expect(courses.culture!.stops[0].place.contentId).toBe(museum.contentId);
  });

  it("다른 시군의 장소는 앵커가 될 수 없다", () => {
    const otherSigungu = makePlace({ sigunguCode: 1, safety: makeSafety(95) });
    const local = makePlace({ safety: makeSafety(70) });
    const courses = buildThemedCourses(SIGUNGU, [
      otherSigungu,
      local,
      ...baseSupport(),
    ]);
    expect(courses.nature!.stops[0].place.contentId).toBe(local.contentId);
  });

  it("테마 매칭 앵커가 없으면(내륙 시군의 water) 그 테마는 null", () => {
    const courses = buildThemedCourses(SIGUNGU, [
      makePlace({ envType: "outdoor_general" }),
      ...baseSupport(),
    ]);
    expect(courses.water).toBeNull();
    expect(courses.nature).not.toBeNull();
  });
});

describe("buildThemedCourses — 스톱 구성", () => {
  it("점심·오후 후보가 반경 밖이면(스톱 2개 미만) null", () => {
    const anchor = makePlace();
    const farLunch = makeRestaurant({ lat: 37.9 }); // 11.1km > 10km
    const farAfternoon = makePlace({ lat: 37.95, sigunguCode: 1 }); // 앵커에서 16.7km
    const courses = buildThemedCourses(SIGUNGU, [
      anchor,
      farLunch,
      farAfternoon,
    ]);
    expect(courses.nature).toBeNull();
  });

  it("점심·오후는 시군 경계를 넘어도 반경 내면 허용", () => {
    const anchor = makePlace();
    const lunch = makeRestaurant({ lat: 37.88, sigunguCode: 1 });
    const afternoon = makePlace({ lat: 37.88, sigunguCode: 1 });
    const courses = buildThemedCourses(SIGUNGU, [anchor, lunch, afternoon]);
    const slots = courses.nature!.stops.map((s) => s.slot);
    expect(slots).toEqual(["morning", "lunch", "afternoon"]);
  });

  it("최고점 음식점이 카페(A05020900)면 점심에서 제외하고 차순위 일반 음식점 선택", () => {
    const anchor = makePlace();
    const cafe = makeRestaurant({
      lat: 37.88,
      cat3: CAT3_CAFE,
      safety: makeSafety(95),
    });
    const restaurant = makeRestaurant({ lat: 37.88, safety: makeSafety(80) });
    const afternoon = makePlace({
      lat: 37.88,
      sigunguCode: 1,
      safety: makeSafety(75),
    });
    const course = buildThemedCourses(SIGUNGU, [
      anchor,
      cafe,
      restaurant,
      afternoon,
    ]).nature!;
    const lunchStop = course.stops.find((s) => s.slot === "lunch")!;
    expect(lunchStop.place.contentId).toBe(restaurant.contentId);
    // 카페는 점심 대안(alternates)에도 등장하지 않는다
    expect(lunchStop.alternates.map((a) => a.contentId)).not.toContain(
      cafe.contentId,
    );
  });

  it("totalKm는 추천 스톱 구간 거리 합이며 소수 1자리", () => {
    const anchor = makePlace();
    const lunch = makeRestaurant({ lat: 37.88 }); // ≈8.9km
    const afternoon = makePlace({
      lat: 37.96,
      sigunguCode: 1, // 오전 대안으로 소모되지 않게 이웃 시군
      safety: makeSafety(75),
    }); // 점심에서 ≈8.9km
    const courses = buildThemedCourses(SIGUNGU, [anchor, lunch, afternoon]);
    const course = courses.nature!;
    expect(course.totalKm).toBeCloseTo(17.8, 0);
    expect(course.totalKm).toBe(Math.round(course.totalKm * 10) / 10);
  });
});

describe("buildThemedCourses — 대안(alternates)", () => {
  it("대안은 슬롯당 최대 2개, 앵커·다른 스톱·다른 대안과 중복되지 않는다", () => {
    const places = [
      // 오전 후보 4곳 (같은 시군, nature 매칭)
      makePlace({ safety: makeSafety(90) }),
      makePlace({ safety: makeSafety(85) }),
      makePlace({ safety: makeSafety(80) }),
      makePlace({ safety: makeSafety(75) }),
      // 점심 후보 3곳
      makeRestaurant({ lat: 37.88, safety: makeSafety(90) }),
      makeRestaurant({ lat: 37.88, safety: makeSafety(85) }),
      makeRestaurant({ lat: 37.88, safety: makeSafety(80) }),
      // 오후 후보 3곳 (점심에서 반경 내, 시군 밖이어도 허용)
      makePlace({ lat: 37.96, sigunguCode: 1, safety: makeSafety(88) }),
      makePlace({ lat: 37.96, sigunguCode: 1, safety: makeSafety(84) }),
      makePlace({ lat: 37.96, sigunguCode: 1, safety: makeSafety(78) }),
    ];
    const course = buildThemedCourses(SIGUNGU, places).nature!;
    const seen = new Set<number>();
    for (const stop of course.stops) {
      expect(stop.alternates.length).toBeLessThanOrEqual(2);
      for (const p of [stop.place, ...stop.alternates]) {
        expect(seen.has(p.contentId)).toBe(false);
        seen.add(p.contentId);
      }
    }
    // 오전 대안은 점수 차순위(85, 80) — 4위(75)는 밀려난다
    expect(course.stops[0].alternates.map((a) => a.safety.score)).toEqual([
      85, 80,
    ]);
  });

  it("대안도 같은 슬롯 조건을 지킨다 — 반경 밖 음식점은 점심 대안이 될 수 없다", () => {
    const anchor = makePlace();
    const lunch = makeRestaurant({ lat: 37.88 });
    const farLunch = makeRestaurant({ lat: 37.9, safety: makeSafety(95) }); // 11.1km
    const afternoon = makePlace({ lat: 37.88, safety: makeSafety(75) });
    const course = buildThemedCourses(SIGUNGU, [
      anchor,
      lunch,
      farLunch,
      afternoon,
    ]).nature!;
    const lunchStop = course.stops.find((s) => s.slot === "lunch")!;
    expect(lunchStop.place.contentId).toBe(lunch.contentId);
    expect(lunchStop.alternates).toEqual([]);
  });
});

describe("buildThemedCourses — 60점 컷", () => {
  it("모든 스톱·대안은 60점 이상이며, 60점 미만 후보는 대안에서도 배제", () => {
    const anchor = makePlace({ safety: makeSafety(80) });
    const lunch = makeRestaurant({ lat: 37.88, safety: makeSafety(60) });
    const badLunch = makeRestaurant({ lat: 37.84, safety: makeSafety(59) });
    const afternoon = makePlace({ lat: 37.88, safety: makeSafety(70) });
    const badAfternoon = makePlace({ lat: 37.88, safety: makeSafety(59) });
    const course = buildThemedCourses(SIGUNGU, [
      anchor,
      lunch,
      badLunch,
      afternoon,
      badAfternoon,
    ]).nature!;
    const everyone = course.stops.flatMap((s) => [s.place, ...s.alternates]);
    expect(everyone.every((p) => p.safety.score >= 60)).toBe(true);
    expect(everyone.map((p) => p.contentId)).not.toContain(badLunch.contentId);
    expect(everyone.map((p) => p.contentId)).not.toContain(
      badAfternoon.contentId,
    );
  });

  it("앵커 후보가 전부 60점 미만이면 null", () => {
    const weak = makePlace({ safety: makeSafety(59) });
    const courses = buildThemedCourses(SIGUNGU, [weak, ...baseSupport()]);
    expect(courses.nature).toBeNull();
  });
});

describe("관광 매력도 우대 (사진·큐레이션)", () => {
  it("안전점수가 근소하게 낮아도 대표사진 있는 곳이 앵커가 된다", () => {
    const noPhoto = makePlace({ title: "무명 시설", safety: makeSafety(91) });
    const withPhoto = makePlace({
      title: "대표 관광지",
      imageUrl: "http://tong.visitkorea.or.kr/x.jpg",
      safety: makeSafety(90),
    });
    const lunch = makeRestaurant({ safety: makeSafety(90) });
    const courses = buildThemedCourses(SIGUNGU, [noPhoto, withPhoto, lunch]);
    expect(courses.nature?.stops[0].place.title).toBe("대표 관광지");
  });

  it("큐레이션 관광지는 사진만 있는 곳보다 우선한다 (동점일 때)", () => {
    const curated = makePlace({
      contentId: 128788, // 설악산 케이블카 — CURATED_PLACES 실존 id
      title: "큐레이션 관광지",
      imageUrl: "http://tong.visitkorea.or.kr/a.jpg",
      safety: makeSafety(90),
    });
    const photoOnly = makePlace({
      title: "사진만 있는 곳",
      imageUrl: "http://tong.visitkorea.or.kr/b.jpg",
      safety: makeSafety(90),
    });
    const lunch = makeRestaurant({ safety: makeSafety(90) });
    const courses = buildThemedCourses(SIGUNGU, [photoOnly, curated, lunch]);
    expect(courses.nature?.stops[0].place.title).toBe("큐레이션 관광지");
  });

  it("안전점수 차이가 크면(우대 폭 초과) 여전히 안전한 곳이 이긴다", () => {
    const muchSafer = makePlace({ title: "훨씬 안전", safety: makeSafety(99) });
    const withPhoto = makePlace({
      title: "사진 있는 곳",
      imageUrl: "http://tong.visitkorea.or.kr/x.jpg",
      safety: makeSafety(80),
    });
    const lunch = makeRestaurant({ safety: makeSafety(90) });
    const courses = buildThemedCourses(SIGUNGU, [muchSafer, withPhoto, lunch]);
    expect(courses.nature?.stops[0].place.title).toBe("훨씬 안전");
  });
});

describe("buildThemedCourses — 자차 반경 배율", () => {
  it("점심 11.1km: 기본(10km)에선 제외, 자차 배율(15km)에선 포함", () => {
    const anchor = makePlace({ safety: makeSafety(90) });
    const lunch11 = makeRestaurant({ lat: 37.9 }); // +0.1도 ≈ 11.1km
    const afternoon = makePlace({
      lat: 37.88,
      sigunguCode: 1,
      safety: makeSafety(75),
    });
    const all = [anchor, lunch11, afternoon];

    const base = buildThemedCourses(SIGUNGU, all);
    expect(base.nature!.stops.map((s) => s.slot)).not.toContain("lunch");

    const car = buildThemedCourses(SIGUNGU, all, CAR_COURSE_RADIUS_SCALE);
    expect(car.nature!.stops.map((s) => s.slot)).toContain("lunch");
  });

  it("오후 16.7km: 기본(15km)에선 제외, 자차 배율(22.5km)에선 포함", () => {
    const anchor = makePlace({ safety: makeSafety(90) });
    // 점심 없음 → 오후는 앵커 기준. 기본 반경이면 스톱이 앵커뿐이라 코스 null
    const afternoon167 = makePlace({
      lat: 37.95, // +0.15도 ≈ 16.7km
      sigunguCode: 1,
      safety: makeSafety(75),
    });
    const all = [anchor, afternoon167];

    expect(buildThemedCourses(SIGUNGU, all).nature).toBeNull();

    const car = buildThemedCourses(SIGUNGU, all, CAR_COURSE_RADIUS_SCALE);
    expect(car.nature!.stops.map((s) => s.slot)).toEqual([
      "morning",
      "afternoon",
    ]);
  });
});
