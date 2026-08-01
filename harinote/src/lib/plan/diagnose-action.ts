"use server";

/**
 * 계획 안전 진단 서버 액션 — 플래너(클라이언트)의 스톱 목록을 받아
 * 각 스톱을 해당 일차의 실제 날짜 기준으로 재채점하고,
 * 주의 스톱에는 같은 날짜 기준 교체 후보를 붙여 반환한다.
 *
 * 날짜 규칙 (상세 페이지와 동일 엔진):
 * - 일차 날짜 = 출발일 + (일차-1). 출발일 미설정이면 오늘 출발로 가정.
 * - 오늘  → 실황 점수 (getSpotSafety)
 * - D+1~3 → 기상청 단기예보 (getDateSafety forecast)
 * - D+4~  → 30년 계절 통계 (getDateSafety seasonal)
 */
import {
  getDateSafety,
  getPlace,
  getPlacesWithSafety,
  getPlacesWithSafetyOnDate,
  getSpotSafety,
  type PlaceWithSafety,
} from "@/lib/datasource";
import { PROFILE_LABEL, type Profile } from "@/lib/safety/types";
import { CAR_DISTANCE_KM, recommendAlternatives } from "@/lib/reco/alternatives";
import { addDaysISO, dayOffsetSeoul, isValidISODate, todayISOSeoul } from "@/lib/date";
import { lodgingById } from "@/lib/tour/lodging";
import {
  MAX_STOPS,
  topRiskFactors,
  type PlanDiagnosisDto,
  type StopDiagnosisDto,
} from "@/lib/plan/diagnose";

/** 플래너 상한(3박 4일 × 일차별 담기)보다 넉넉한 방어 상한 */
// MAX_STOPS는 diagnose.ts에 둔다 — "use server" 모듈은 async 함수만 export할 수 있다
const MAX_DAY = 14;
/** 스톱당 교체 후보 수 — 패널 안에 들어가야 해서 소수만 */
const ALT_LIMIT = 2;
/** 대중교통 기준 후보 반경 (reco/alternatives 기본값과 동일) */
const TRANSIT_DISTANCE_KM = 30;

export interface DiagnoseStopInput {
  contentId: number;
  day?: number;
}

export async function diagnosePlan(input: {
  items: DiagnoseStopInput[];
  /** 여행 출발일 (YYYY-MM-DD) — 없으면 오늘 출발 가정 */
  from?: string;
  profile: Profile;
  transport?: "transit" | "car";
}): Promise<PlanDiagnosisDto> {
  // 서버 액션은 공개 엔드포인트 — 클라이언트 타입을 믿지 않고 검증 (recommend-action과 동일 원칙)
  if (
    typeof input !== "object" ||
    input === null ||
    !Array.isArray(input.items) ||
    input.items.length === 0 ||
    input.items.length > MAX_STOPS ||
    typeof input.profile !== "string" ||
    !Object.hasOwn(PROFILE_LABEL, input.profile) ||
    (input.transport !== undefined &&
      input.transport !== "transit" &&
      input.transport !== "car")
  ) {
    throw new Error("잘못된 요청입니다.");
  }
  for (const it of input.items) {
    if (
      typeof it !== "object" ||
      it === null ||
      typeof it.contentId !== "number" ||
      !Number.isInteger(it.contentId) ||
      (it.day !== undefined &&
        (!Number.isInteger(it.day) || it.day < 1 || it.day > MAX_DAY))
    ) {
      throw new Error("잘못된 요청입니다.");
    }
  }

  const today = todayISOSeoul();
  // 출발일: 유효한 오늘~1년 내 날짜만 인정, 아니면 오늘 출발 가정 (throw 아님 — 낡은 계획 UX 보호)
  const fromValid =
    typeof input.from === "string" &&
    isValidISODate(input.from) &&
    dayOffsetSeoul(input.from) >= 0 &&
    dayOffsetSeoul(input.from) <= 365;
  const baseISO = fromValid ? (input.from as string) : today;

  const maxKm = input.transport === "car" ? CAR_DISTANCE_KM : TRANSIT_DISTANCE_KM;

  const stops: StopDiagnosisDto[] = await Promise.all(
    input.items.map(async (it): Promise<StopDiagnosisDto> => {
      const day = it.day ?? 1;
      const dateISO = addDaysISO(baseISO, day - 1);
      const unknown: StopDiagnosisDto = {
        contentId: it.contentId,
        day,
        dateISO,
        mode: "unknown",
        score: null,
        grade: null,
        topFactors: [],
        riskFactors: [],
        alternatives: [],
      };

      // 관광지에 없으면 숙박 데이터셋 폴백 — 계획에 담긴 숙소도 날짜 기준 채점
      const tourPlace = await getPlace(it.contentId);
      const place = tourPlace ?? lodgingById(it.contentId);
      if (!place) return unknown;

      const isToday = dateISO === today;
      let mode: StopDiagnosisDto["mode"];
      let breakdown;
      if (isToday) {
        breakdown = await getSpotSafety(place, input.profile);
        mode = "today";
      } else {
        const ds = await getDateSafety(place, input.profile, dateISO);
        breakdown = ds?.breakdown ?? null;
        mode = ds?.mode ?? "unknown";
      }
      if (!breakdown) return unknown;

      // 주의 스톱에만 같은 날짜 기준 교체 후보 — 목록 캐시를 공유해 호출 비용 최소화.
      // 숙소는 관광지 후보로 교체할 수 없으므로 제공하지 않는다
      let alternatives: StopDiagnosisDto["alternatives"] = [];
      if (breakdown.grade !== "low" && tourPlace) {
        const candidates = isToday
          ? await getPlacesWithSafety(undefined, input.profile)
          : await getPlacesWithSafetyOnDate(input.profile, dateISO);
        const target: PlaceWithSafety = { ...tourPlace, safety: breakdown };
        alternatives = recommendAlternatives(target, candidates, ALT_LIMIT, maxKm).map(
          (alt) => ({
            contentId: alt.contentId,
            title: alt.title,
            lat: alt.lat,
            lng: alt.lng,
            score: alt.safety.score,
            distanceKm: Math.round(alt.distanceKm * 10) / 10,
          }),
        );
      }

      return {
        ...unknown,
        mode,
        score: breakdown.score,
        grade: breakdown.grade,
        topFactors: topRiskFactors(breakdown),
        riskFactors: breakdown.factors
          .filter((f) => f.points > 0)
          .map((f) => ({ key: f.key, value: f.value })),
        alternatives,
      };
    }),
  );

  return {
    stops,
    baseISO,
    assumedToday: !fromValid,
    riskyCount: stops.filter((s) => s.grade !== null && s.grade !== "low").length,
  };
}
