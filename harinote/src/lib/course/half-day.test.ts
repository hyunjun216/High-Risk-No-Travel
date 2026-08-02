/**
 * 안전 반나절 코스 자동 생성 테스트.
 * 좌표 참고: 위도 0.1도 ≈ 11.1km — 앵커(37.8, 128.0) 기준
 * +0.08도 ≈ 8.9km(점심 10km 이내), +0.1도 ≈ 11.1km(10km 초과),
 * +0.13도 ≈ 14.5km(오후 15km 이내), +0.15도 ≈ 16.7km(15km 초과).
 */
import { describe, expect, it } from "vitest";
import type { PlaceWithSafety } from "@/lib/datasource";
import type { Alternative } from "@/lib/reco/alternatives";
import type { RiskBreakdown, RiskFactor, RiskFactorKey, RiskLevel } from "@/lib/safety/types";
import { buildHalfDayCourse } from "@/lib/course/half-day";
import { CAT3_CAFE } from "@/lib/tour/types";

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
    cat1: "A02",
    cat2: "A0202",
    cat3: "A02020300",
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
  return makePlace({
    contentTypeId: 39,
    title: "테스트 음식점",
    cat1: "A05",
    cat2: "A0502",
    cat3: "A05020100",
    ...overrides,
  });
}

function makeAlt(overrides: Partial<PlaceWithSafety> = {}): Alternative {
  return { ...makePlace(overrides), distanceKm: 5 };
}

/** 기본 3스톱 코스가 나오는 후보 세트 (점심 8.9km, 오후는 점심에서 8.9km) */
function baseCandidates() {
  const lunch = makeRestaurant({ lat: 37.88 });
  const afternoon = makePlace({ lat: 37.96, safety: makeSafety(75) });
  return { lunch, afternoon, candidates: [lunch, afternoon] };
}

describe("buildHalfDayCourse — 앵커 결정", () => {
  it("target이 '주의 요인 높음'이면 대체지 1순위를 앵커로 전환", () => {
    const target = makePlace({ safety: makeSafety(35) });
    const alt = makeAlt({ safety: makeSafety(80) });
    const { candidates } = baseCandidates();
    const course = buildHalfDayCourse(target, [alt], candidates);
    expect(course).not.toBeNull();
    expect(course!.anchoredOnAlternative).toBe(true);
    expect(course!.stops[0].place.contentId).toBe(alt.contentId);
  });

  it("target이 '주의 요인 있음' + 대체지 1순위가 +10점 이상이면 전환", () => {
    const target = makePlace({ safety: makeSafety(60) });
    const alt = makeAlt({ safety: makeSafety(70) }); // +10
    const { candidates } = baseCandidates();
    const course = buildHalfDayCourse(target, [alt], candidates);
    expect(course!.anchoredOnAlternative).toBe(true);
    expect(course!.stops[0].place.contentId).toBe(alt.contentId);
  });

  it("'주의 요인 있음'이라도 개선 폭이 +10점 미만이면 target 유지", () => {
    const target = makePlace({ safety: makeSafety(60) });
    const alt = makeAlt({ safety: makeSafety(69) }); // +9
    const { candidates } = baseCandidates();
    const course = buildHalfDayCourse(target, [alt], candidates);
    expect(course!.anchoredOnAlternative).toBe(false);
    expect(course!.stops[0].place.contentId).toBe(target.contentId);
  });

  it("target이 '주의 요인 낮음'이면 더 좋은 대체지가 있어도 target 유지", () => {
    const target = makePlace({ safety: makeSafety(75) });
    const alt = makeAlt({ safety: makeSafety(95) });
    const { candidates } = baseCandidates();
    const course = buildHalfDayCourse(target, [alt], candidates);
    expect(course!.anchoredOnAlternative).toBe(false);
    expect(course!.stops[0].place.contentId).toBe(target.contentId);
  });

  it("위험한 target인데 대체지가 없으면(앵커 60점 미만) null", () => {
    const target = makePlace({ safety: makeSafety(35) });
    const { candidates } = baseCandidates();
    expect(buildHalfDayCourse(target, [], candidates)).toBeNull();
  });
});

describe("buildHalfDayCourse — 점심 스톱", () => {
  const target = makePlace({ safety: makeSafety(80) });

  it("반경 10km 내 음식점 중 안전점수 최고를 선택", () => {
    const worse = makeRestaurant({ lat: 37.88, safety: makeSafety(70) });
    const better = makeRestaurant({ lat: 37.88, safety: makeSafety(90) });
    const course = buildHalfDayCourse(target, [], [worse, better]);
    const lunch = course!.stops.find((s) => s.slot === "lunch");
    expect(lunch!.place.contentId).toBe(better.contentId);
  });

  it("안전점수 동점이면 가까운 음식점 선택", () => {
    const far = makeRestaurant({ lat: 37.88 }); // ≈8.9km
    const near = makeRestaurant({ lat: 37.84 }); // ≈4.4km
    const course = buildHalfDayCourse(target, [], [far, near]);
    const lunch = course!.stops.find((s) => s.slot === "lunch");
    expect(lunch!.place.contentId).toBe(near.contentId);
  });

  it("최고점 음식점이 카페(A05020900)면 제외하고 차순위 일반 음식점 선택", () => {
    const cafe = makeRestaurant({
      lat: 37.88,
      cat3: CAT3_CAFE,
      safety: makeSafety(95),
    });
    const restaurant = makeRestaurant({ lat: 37.88, safety: makeSafety(80) });
    const course = buildHalfDayCourse(target, [], [cafe, restaurant]);
    const lunch = course!.stops.find((s) => s.slot === "lunch");
    expect(lunch!.place.contentId).toBe(restaurant.contentId);
  });

  it("10km 초과 음식점은 제외 — 점심 슬롯 생략 후 2스톱 코스", () => {
    const tooFar = makeRestaurant({ lat: 37.9 }); // ≈11.1km
    const afternoon = makePlace({ lat: 37.88 });
    const course = buildHalfDayCourse(target, [], [tooFar, afternoon]);
    expect(course!.stops.map((s) => s.slot)).toEqual(["morning", "afternoon"]);
  });
});

describe("buildHalfDayCourse — 오후 스톱", () => {
  it("앵커의 기상 감점이 크면(weatherRisk >= 15) 실내 후보 우선", () => {
    const target = makePlace({ safety: makeSafety(70, 15) });
    const outdoor = makePlace({ lat: 37.88, safety: makeSafety(90) });
    const indoor = makePlace({
      lat: 37.88,
      contentTypeId: 14,
      envType: "indoor",
      safety: makeSafety(65),
    });
    const course = buildHalfDayCourse(target, [], [outdoor, indoor]);
    const pm = course!.stops.find((s) => s.slot === "afternoon");
    expect(pm!.place.contentId).toBe(indoor.contentId);
  });

  it("기상 감점이 작으면(weatherRisk < 15) 실내 우대 없이 안전점수 최고", () => {
    const target = makePlace({ safety: makeSafety(70, 14) });
    const outdoor = makePlace({ lat: 37.88, safety: makeSafety(90) });
    const indoor = makePlace({
      lat: 37.88,
      contentTypeId: 14,
      envType: "indoor",
      safety: makeSafety(65),
    });
    const course = buildHalfDayCourse(target, [], [outdoor, indoor]);
    const pm = course!.stops.find((s) => s.slot === "afternoon");
    expect(pm!.place.contentId).toBe(outdoor.contentId);
  });

  it("앵커와 같은 소분류(cat3)면 소폭 가점 — 점수 1점 차이를 뒤집는다", () => {
    const target = makePlace({ safety: makeSafety(80) });
    const diffCat3 = makePlace({
      lat: 37.88,
      cat3: "A02020400",
      safety: makeSafety(80),
    });
    const sameCat3 = makePlace({ lat: 37.88, safety: makeSafety(79) }); // 79+3 > 80
    const course = buildHalfDayCourse(target, [], [diffCat3, sameCat3]);
    const pm = course!.stops.find((s) => s.slot === "afternoon");
    expect(pm!.place.contentId).toBe(sameCat3.contentId);
  });

  it("탐색 반경은 점심 스톱 기준 15km — 앵커에서 멀어도 점심에서 가까우면 포함", () => {
    const target = makePlace({ safety: makeSafety(80) });
    const lunch = makeRestaurant({ lat: 37.88 }); // 앵커에서 ≈8.9km
    const afternoon = makePlace({ lat: 38.0, safety: makeSafety(75) }); // 점심에서 ≈13.3km, 앵커에서 ≈22.2km
    const course = buildHalfDayCourse(target, [], [lunch, afternoon]);
    const pm = course!.stops.find((s) => s.slot === "afternoon");
    expect(pm!.place.contentId).toBe(afternoon.contentId);
  });

  it("점심 스톱에서 15km 초과 후보는 제외", () => {
    const target = makePlace({ safety: makeSafety(80) });
    const lunch = makeRestaurant({ lat: 37.88 });
    const tooFar = makePlace({ lat: 38.03, safety: makeSafety(95) }); // 점심에서 ≈16.7km
    const course = buildHalfDayCourse(target, [], [lunch, tooFar]);
    expect(course!.stops.map((s) => s.slot)).toEqual(["morning", "lunch"]);
  });
});

describe("buildHalfDayCourse — 60점 컷·부분 코스", () => {
  it("안전점수 60점 미만은 어떤 슬롯에도 넣지 않는다", () => {
    const target = makePlace({ safety: makeSafety(80) });
    const badLunch = makeRestaurant({ lat: 37.84, safety: makeSafety(59) });
    const okLunch = makeRestaurant({ lat: 37.88, safety: makeSafety(60) });
    const badAfternoon = makePlace({ lat: 37.84, safety: makeSafety(59) });
    const course = buildHalfDayCourse(target, [], [
      badLunch,
      okLunch,
      badAfternoon,
    ]);
    const ids = course!.stops.map((s) => s.place.contentId);
    expect(ids).toEqual([target.contentId, okLunch.contentId]);
  });

  it("점심·오후 후보가 모두 없으면(스톱 1개) null", () => {
    const target = makePlace({ safety: makeSafety(80) });
    expect(buildHalfDayCourse(target, [], [])).toBeNull();
  });

  it("후보가 전부 60점 미만이어도 null", () => {
    const target = makePlace({ safety: makeSafety(80) });
    const candidates = [
      makeRestaurant({ lat: 37.84, safety: makeSafety(50) }),
      makePlace({ lat: 37.84, safety: makeSafety(55) }),
    ];
    expect(buildHalfDayCourse(target, [], candidates)).toBeNull();
  });
});

describe("buildHalfDayCourse — 중복 스톱 방지", () => {
  it("앵커 자신은 오후 스톱으로 재등장하지 않는다", () => {
    const target = makePlace({ safety: makeSafety(80) });
    const lunch = makeRestaurant({ lat: 37.88 });
    // 후보에 target 자신이 섞여 있어도 무시
    const course = buildHalfDayCourse(target, [], [target, lunch]);
    expect(course!.stops.map((s) => s.slot)).toEqual(["morning", "lunch"]);
  });

  it("대체지 앵커 전환 시 위험한 target을 오후 스톱으로 넣지 않는다", () => {
    const target = makePlace({ safety: makeSafety(60) }); // moderate, 60점 컷은 통과
    const alt = makeAlt({ safety: makeSafety(80) }); // +20 → 전환
    const lunch = makeRestaurant({ lat: 37.88 });
    const course = buildHalfDayCourse(target, [alt], [target, lunch]);
    expect(course!.anchoredOnAlternative).toBe(true);
    const ids = course!.stops.map((s) => s.place.contentId);
    expect(ids).not.toContain(target.contentId);
  });
});

describe("buildHalfDayCourse — 거리 계산", () => {
  it("legKm는 이전 스톱과의 거리, 첫 스톱은 undefined", () => {
    const target = makePlace({ safety: makeSafety(80) });
    const lunch = makeRestaurant({ lat: 37.88 }); // ≈8.9km
    const afternoon = makePlace({ lat: 37.98, safety: makeSafety(75) }); // 점심에서 ≈11.1km
    const course = buildHalfDayCourse(target, [], [lunch, afternoon]);
    const [m, l, a] = course!.stops;
    expect(m.legKm).toBeUndefined();
    expect(l.legKm).toBeCloseTo(8.9, 0);
    expect(a.legKm).toBeCloseTo(11.1, 0);
  });

  it("totalKm는 legKm 합이며 소수 1자리", () => {
    const target = makePlace({ safety: makeSafety(80) });
    const lunch = makeRestaurant({ lat: 37.88 });
    const afternoon = makePlace({ lat: 37.98, safety: makeSafety(75) });
    const course = buildHalfDayCourse(target, [], [lunch, afternoon]);
    const legSum = course!.stops.reduce((sum, s) => sum + (s.legKm ?? 0), 0);
    expect(course!.totalKm).toBeCloseTo(legSum, 5);
    expect(course!.totalKm).toBe(Math.round(course!.totalKm * 10) / 10);
  });

  it("스톱 순서는 오전 → 점심 → 오후", () => {
    const target = makePlace({ safety: makeSafety(80) });
    const { candidates } = baseCandidates();
    const course = buildHalfDayCourse(target, [], candidates);
    expect(course!.stops.map((s) => s.slot)).toEqual([
      "morning",
      "lunch",
      "afternoon",
    ]);
  });
});
