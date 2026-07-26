import { beforeEach, describe, expect, it, vi } from "vitest";

// 데이터 파이프라인을 타지 않도록 mock — 검증·날짜 분기·대체 후보 조립만 본다
vi.mock("@/lib/datasource", () => ({
  getPlace: vi.fn(async () => null),
  getSpotSafety: vi.fn(async () => null),
  getDateSafety: vi.fn(async () => null),
  getPlacesWithSafety: vi.fn(async () => []),
  getPlacesWithSafetyOnDate: vi.fn(async () => []),
}));

import { diagnosePlan } from "./diagnose-action";
import {
  getDateSafety,
  getPlace,
  getPlacesWithSafety,
  getSpotSafety,
} from "@/lib/datasource";
import { addDaysISO, todayISOSeoul } from "@/lib/date";
import type { RiskBreakdown } from "@/lib/safety/types";

const PLACE = {
  contentId: 1,
  title: "설악산",
  lat: 38.1,
  lng: 128.4,
  contentTypeId: 12,
  cat3: "A01010400",
  envType: "mountain",
  sigunguCode: 5,
} as never;

function breakdown(score: number, grade: RiskBreakdown["grade"]): RiskBreakdown {
  return {
    score,
    grade,
    profile: "default",
    factors: [],
    weatherRisk: 0,
    disasterRisk: 0,
    medicalRisk: 0,
    mobilityRisk: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("diagnosePlan — 공개 엔드포인트 입력 검증", () => {
  it("빈 items·비정수 contentId·범위 밖 day를 거부한다", async () => {
    await expect(
      diagnosePlan({ items: [], profile: "default" }),
    ).rejects.toThrow("잘못된 요청");
    await expect(
      diagnosePlan({ items: [{ contentId: 1.5 }], profile: "default" }),
    ).rejects.toThrow("잘못된 요청");
    await expect(
      diagnosePlan({ items: [{ contentId: 1, day: 0 }], profile: "default" }),
    ).rejects.toThrow("잘못된 요청");
    await expect(
      diagnosePlan({ items: [{ contentId: 1, day: 99 }], profile: "default" }),
    ).rejects.toThrow("잘못된 요청");
  });

  it("프로토타입 체인 프로필 키를 거부한다", async () => {
    await expect(
      diagnosePlan({ items: [{ contentId: 1 }], profile: "constructor" as never }),
    ).rejects.toThrow("잘못된 요청");
  });
});

describe("diagnosePlan — 날짜 분기", () => {
  it("출발일 미설정이면 오늘 출발 가정: 1일차는 실황, 2일차는 날짜 점수", async () => {
    vi.mocked(getPlace).mockResolvedValue(PLACE);
    vi.mocked(getSpotSafety).mockResolvedValue(breakdown(90, "low"));
    vi.mocked(getDateSafety).mockResolvedValue({
      mode: "forecast",
      dateISO: addDaysISO(todayISOSeoul(), 1),
      dayOffset: 1,
      breakdown: breakdown(85, "low"),
    });

    const result = await diagnosePlan({
      items: [
        { contentId: 1, day: 1 },
        { contentId: 1, day: 2 },
      ],
      profile: "default",
    });

    expect(result.assumedToday).toBe(true);
    expect(result.baseISO).toBe(todayISOSeoul());
    expect(result.stops[0].mode).toBe("today");
    expect(result.stops[0].score).toBe(90);
    expect(result.stops[1].mode).toBe("forecast");
    expect(getDateSafety).toHaveBeenCalledWith(
      PLACE,
      "default",
      addDaysISO(todayISOSeoul(), 1),
    );
  });

  it("무효한 출발일(과거·형식 오류)은 오늘 출발로 폴백한다", async () => {
    vi.mocked(getPlace).mockResolvedValue(PLACE);
    vi.mocked(getSpotSafety).mockResolvedValue(breakdown(90, "low"));

    const result = await diagnosePlan({
      items: [{ contentId: 1 }],
      from: "2000-01-01",
      profile: "default",
    });
    expect(result.assumedToday).toBe(true);
    expect(result.baseISO).toBe(todayISOSeoul());
  });

  it("장소가 없거나 점수를 못 만들면 unknown 스톱으로 반환한다", async () => {
    vi.mocked(getPlace).mockResolvedValue(null);
    const result = await diagnosePlan({
      items: [{ contentId: 404 }],
      profile: "default",
    });
    expect(result.stops[0]).toMatchObject({ mode: "unknown", score: null, grade: null });
    expect(result.riskyCount).toBe(0);
  });
});

describe("diagnosePlan — 주의 스톱 대체 후보", () => {
  it("grade가 low가 아니면 같은 날짜 후보에서 교체 후보를 붙인다", async () => {
    vi.mocked(getPlace).mockResolvedValue(PLACE);
    vi.mocked(getSpotSafety).mockResolvedValue(breakdown(55, "moderate"));
    // 같은 cat3 + 점수 개선 충분(+5 이상) + 30km 이내 후보 1곳
    vi.mocked(getPlacesWithSafety).mockResolvedValue([
      {
        ...(PLACE as object),
        contentId: 2,
        title: "오색령",
        lat: 38.12,
        lng: 128.42,
        safety: breakdown(80, "low"),
      },
    ] as never);

    const result = await diagnosePlan({
      items: [{ contentId: 1, day: 1 }],
      profile: "default",
    });

    expect(result.riskyCount).toBe(1);
    expect(result.stops[0].alternatives).toHaveLength(1);
    expect(result.stops[0].alternatives[0]).toMatchObject({
      contentId: 2,
      title: "오색령",
      score: 80,
    });
  });

  it("grade가 low면 대체 후보를 계산하지 않는다", async () => {
    vi.mocked(getPlace).mockResolvedValue(PLACE);
    vi.mocked(getSpotSafety).mockResolvedValue(breakdown(95, "low"));
    const result = await diagnosePlan({
      items: [{ contentId: 1 }],
      profile: "default",
    });
    expect(result.stops[0].alternatives).toEqual([]);
    expect(getPlacesWithSafety).not.toHaveBeenCalled();
  });
});
