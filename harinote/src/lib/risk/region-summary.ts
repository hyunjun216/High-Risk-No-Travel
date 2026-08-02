/**
 * 시군별 안전점수 집계 — /map 시군 위험 지도의 데이터 소스.
 *
 * 대표값은 평균이 아니라 **중앙값**을 쓴다: 시군 안에 극단 점수(고립 산악지 등)가
 * 섞여도 "이 시군의 오늘 분위기"가 덜 왜곡되도록.
 * 등급 판정은 새 임계값 없이 기존 gradeForScore(weights.ts)를 그대로 재사용한다.
 *
 * getRegionSummaries는 datasource(서버 전용)를 호출하므로 이 모듈도 서버 전용.
 * 순수 함수 summarizeRegions는 테스트에서 직접 호출한다.
 */
import type { Profile, RiskFactor, RiskLevel } from "@/lib/safety/types";
import { gradeForScore, levelForPoints, LANDSLIDE, MEDICAL } from "@/lib/safety/weights";
import { SIGUNGU_SEATS } from "@/lib/risk/regions";
import {
  getPlacesWithSafety,
  getPlacesWithSafetyOnDate,
  getPlacesWithSafetyOnRange,
  type PlaceWithSafety,
} from "@/lib/datasource";

export interface RegionSummary {
  sigunguCode: number;
  name: string;
  lat: number;
  lng: number;
  /**
   * 시군 대표 안전점수 = 대표 야외 관광지(중앙값 최근접) 점수에서, 응급의료(시군 중앙값)와
   * 산사태(시군 위험노출 비율×상한)만 시군 집계로 보정한 값. 산사태 최악 1곳을 헤드라인에
   * 박지 않아 전 지역 침몰을 막고, 최고 단계는 landslideAlert 배지로 별도. 0곳이면 null.
   */
  medianScore: number | null;
  /** 대표 점수의 등급(gradeForScore) — 관광지 0곳이면 null */
  grade: RiskLevel | null;
  placeCount: number;
  /**
   * "이 점수가 왜 나왔나" 요인 분해 — 날씨·산불은 대표 관광지(sampleName) 값, 응급의료는
   * 시군 중앙값, 산사태는 시군 위험노출 비율. 0곳이면 []. 점수(medianScore)=요인 감점 합 유지.
   */
  factors: RiskFactor[];
  /** factors의 출처가 된 대표 관광지 이름 (없으면 null) */
  sampleName: string | null;
  /** 시군 내 최고 산사태 단계(0 없음·1 주의보·2 경보) — 배지 라벨용. */
  landslideAlert: 0 | 1 | 2;
  /** 시군 관광지 중 산사태 위험 구역(주의보+) 비율(%) — 배지 강도(옅음·진함) 차등용. */
  landslideExposurePct: number;
}

/** 시군 산사태 감점 상한 — 근거·실측은 weights.ts LANDSLIDE.REGION_CAP 참조 */
const LANDSLIDE_REGION_CAP = LANDSLIDE.REGION_CAP;

/** 정렬된 배열의 중앙값 — 짝수 개면 가운데 두 값 평균을 반올림 */
function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * 관광지 배열 → 강원 18개 시군 요약 (sigunguCode 오름차순).
 * sigunguCode가 없거나 SIGUNGU_SEATS에 없는 관광지는 제외.
 * 관광지 0곳인 시군도 SIGUNGU_SEATS 기준으로 포함한다 (medianScore/grade = null).
 */
export function summarizeRegions(places: PlaceWithSafety[]): RegionSummary[] {
  const placesByCode = new Map<number, PlaceWithSafety[]>();
  for (const place of places) {
    const code = place.sigunguCode;
    if (code === undefined || !(code in SIGUNGU_SEATS)) continue;
    const arr = placesByCode.get(code) ?? [];
    arr.push(place);
    placesByCode.set(code, arr);
  }

  return Object.keys(SIGUNGU_SEATS)
    .map(Number)
    .map((code) => {
      const seat = SIGUNGU_SEATS[code];
      const group = placesByCode.get(code) ?? [];
      const scores = group.map((p) => p.safety.score).sort((a, b) => a - b);

      // 시군 대표 = 실내 제외 야외장소 중 점수가 중앙값에 가장 가까운 곳(medoid).
      // 검증1 하이브리드(da-methodologist): 날씨·산불·산사태는 대표 장소값, 장소 편차가
      // 큰 응급의료만 시군 중앙값으로 보정한다(대표 1곳이 우연히 병원 근처라 안전해 보이는
      // 편향 방지). 산사태는 특정 산악지 국한이라 시군 최고 단계를 별도 landslideAlert로만
      // 노출하고 점수엔 안 넣는다(전 지역 침몰 방지). 점수=요인 감점 합 유지.
      let medianScore: number | null = null;
      let grade: RiskLevel | null = null;
      let factors: RiskFactor[] = [];
      let sampleName: string | null = null;
      let landslideAlert: 0 | 1 | 2 = 0;
      let landslideExposurePct = 0;
      if (scores.length > 0) {
        const anchor = median(scores);
        const general = group.filter((p) => p.envType === "outdoor_general");
        const outdoor = group.filter((p) => p.envType !== "indoor");
        const pool = general.length ? general : outdoor.length ? outdoor : group;
        const rep = pool.reduce((best, p) =>
          Math.abs(p.safety.score - anchor) < Math.abs(best.safety.score - anchor)
            ? p
            : best,
        );
        const repFactors = rep.safety.factors ?? [];
        sampleName = rep.title ?? null;

        // 응급의료 — 시군 관광지 감점의 중앙값(대표 1곳 대신) + 골든타임 커버리지(%).
        const medPts = group
          .map((p) => p.safety.factors?.find((f) => f.key === "medical")?.points)
          .filter((v): v is number => v !== undefined)
          .sort((a, b) => a - b);
        const medKms = group
          .map((p) => p.safety.factors?.find((f) => f.key === "medical")?.value)
          .filter((v): v is number => v !== undefined)
          .sort((a, b) => a - b);
        const repMedical = repFactors.find((f) => f.key === "medical");
        const newMedPts = medPts.length ? median(medPts) : (repMedical?.points ?? 0);
        const newMedKm = medKms.length ? median(medKms) : (repMedical?.value ?? 0);
        const within =
          medKms.length > 0
            ? Math.round(
                (medKms.filter((k) => k <= MEDICAL.NEAR_KM).length / medKms.length) * 100,
              )
            : null;

        // 산사태 — 시군 관광지의 산사태 위험 "노출 비율"로 소폭 반영(경보는 2배 가중).
        // 최악 1곳(-45)을 헤드라인에 박으면 전 지역이 침몰하므로 노출 비율×상한(15)으로
        // 차등만 준다(산악·계곡 집중 시군일수록 큼). 최고 단계는 landslideAlert 배지로 별도.
        let watchN = 0;
        let warnN = 0;
        for (const p of group) {
          const lv = Math.round(
            (p.safety.factors?.find((f) => f.key === "landslide")?.value ?? 0) as number,
          );
          if (lv >= 2) warnN += 1;
          else if (lv >= 1) watchN += 1;
          if (lv > landslideAlert) landslideAlert = Math.min(2, lv) as 0 | 1 | 2;
        }
        const exposure = Math.min(1, (watchN + 2 * warnN) / group.length);
        const landslidePts = Math.round(exposure * LANDSLIDE_REGION_CAP);
        const exposedPct = Math.round(((watchN + warnN) / group.length) * 100);
        landslideExposurePct = exposedPct;
        const repLandslide = repFactors.find((f) => f.key === "landslide");

        // 점수 = 대표 점수 − (의료·산사태 시군집계 차이). 100−요인 감점 합과 일치.
        const delta =
          newMedPts - (repMedical?.points ?? 0) +
          (landslidePts - (repLandslide?.points ?? 0));
        medianScore = Math.max(0, Math.min(100, rep.safety.score - delta));
        grade = gradeForScore(medianScore);

        // 요인 분해 — 날씨·산불은 대표장소 값, 의료·산사태는 시군 집계로 교체.
        factors = repFactors
          .filter((f) => f.key !== "landslide")
          .map((f) =>
            f.key === "medical"
              ? {
                  ...f,
                  value: newMedKm,
                  points: newMedPts,
                  level: levelForPoints(newMedPts, MEDICAL.MAX_POINTS),
                  description: `최근접 응급의료기관 시군 중앙값 ${newMedKm}km${
                    within !== null
                      ? ` · 관광지 ${within}%가 골든타임(${MEDICAL.NEAR_KM}km) 이내`
                      : ""
                  }`,
                }
              : f,
          );
        if (landslidePts > 0) {
          factors.push({
            key: "landslide",
            label: "산사태",
            value: exposedPct,
            unit: "%",
            threshold: 20,
            points: landslidePts,
            maxPoints: LANDSLIDE_REGION_CAP,
            level: levelForPoints(landslidePts, LANDSLIDE_REGION_CAP),
            description: `시군 관광지 ${exposedPct}%가 산사태 위험 구역(주의보+) — 산지·계곡 집중 시군일수록 큼`,
          });
        }
      }
      return {
        sigunguCode: code,
        name: seat.name,
        lat: seat.lat,
        lng: seat.lng,
        medianScore,
        grade,
        placeCount: scores.length,
        factors,
        sampleName,
        landslideAlert,
        landslideExposurePct,
      };
    })
    // 안전점수 높은 시군부터 (데이터 없는 곳은 맨 뒤)
    .sort((a, b) => (b.medianScore ?? -1) - (a.medianScore ?? -1));
}

/**
 * 전체 관광지의 점수를 시군별로 요약 — 서버 전용.
 * profile·dateISO를 주면 그 조건의 점수로 지도가 반응한다 (홈 날짜 스테퍼).
 * endISO까지 주면 기간 모드 — 기간 중 최악일 대표점수 기준.
 */
export async function getRegionSummaries(
  profile: Profile = "default",
  dateISO?: string,
  endISO?: string,
): Promise<RegionSummary[]> {
  const places = dateISO
    ? endISO
      ? await getPlacesWithSafetyOnRange(profile, dateISO, endISO)
      : await getPlacesWithSafetyOnDate(profile, dateISO)
    : await getPlacesWithSafety(undefined, profile);
  return summarizeRegions(places);
}
