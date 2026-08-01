/**
 * 안전 점수 엔진 — 쾌적층(관광기후지수 TCI) − 안전층(재난·의료 취약성).
 *
 * SafetyScore = TCI(쾌적) − 안전 감점(산불·산사태·응급의료)
 * - 쾌적층: 관광기후지수(K-TCI/KTCI) — 체감온도·강수·미세먼지·바람. envType(실내 할인·
 *   계곡 강수 가중)·프로필(민감층)로 변조. 근거=tci.ts, analysis/23.
 * - 안전층: 산불·산사태(산림청 단계) + 응급의료 접근성(취약성). FEMA/지역안전지수 구조.
 * - 재난 경보급(산불 4단계·산사태 경보): 감점(80)이 등급컷에 앵커돼 총점이 ALERT_BAND_CAP
 *   이하로 보장된다 — 별도 override 로직이 아니라 앵커 설계의 결과. 점수=100−감점 합(항상 일치).
 *   근거=기상청 관광기후지수 '특보발령주의' 등급 + 특보 2단계(경보=이동 자제).
 */
import type { Place } from "@/lib/tour/types";
import type {
  Profile,
  RiskBreakdown,
  RiskFactor,
  RiskInput,
} from "@/lib/safety/types";
import {
  ENV_WEIGHT,
  FOREST_FIRE,
  LANDSLIDE,
  MEDICAL,
  PROFILE_WEIGHT,
  SHELTER,
  forestFirePoints,
  gradeForScore,
  landslidePoints,
  landslideProxyLevel,
  normalizeForestFireLevel,
  levelForPoints,
  medicalPoints,
  pmGradeLabel,
  shelterPoints,
} from "@/lib/safety/weights";
import { computeTciBreakdown } from "@/lib/safety/tci";

/** 재난 경보급(산불4·산사태2)일 때 감점 앵커(80)로 보장되는 총점 상한 — 강제(override)가
 * 아니라 앵커 설계의 결과다. 불변식·테스트 참조용. (기상청 '특보발령주의' 밴드) */
export const ALERT_BAND_CAP = 20;

/** 쾌적층 요인 표시용 명목 상한 (레벨 색상 계산용, TCI 가중 기반) */
const WEATHER_MAX = { thermal: 40, rain: 30, pm: 24, wind: 14, sun: 9 } as const;
/** 안전층 호우(침수·급류) 표시 상한 — 쾌적 강수와 분리된 위험 축 */
const HEAVY_RAIN_MAX = 20;

export function computeSafetyScore(
  input: RiskInput,
  place: Pick<Place, "envType">,
  profile: Profile = "default",
): RiskBreakdown {
  const env = ENV_WEIGHT[place.envType];
  const prof = PROFILE_WEIGHT[profile];
  const factors: RiskFactor[] = [];

  // ── 쾌적층: 관광기후지수(TCI) ──
  // 폭염특보 기준이 "일 최고 체감온도"이므로 체감온도(apparentTempC) 우선, 없으면 건구온도.
  // 민감층은 체감온도를 상향 반영(같은 더위도 더 위험) → thermal 입력 보정.
  const feelsBase = input.apparentTempC ?? input.tempC;
  const feelsEff = feelsBase + prof.heatShiftC;
  const tb = computeTciBreakdown({
    feelsC: feelsEff,
    rainMmDaily: input.rainMm,
    rainProbPct: input.rainProbPct,
    windMs: input.windMs,
    pm25: input.pm25,
    sunHours: input.sunHours, // 하늘상태(SKY) 환산 — 없으면 TCI가 4축 재정규화
  });

  // envType·프로필로 변조 (실내 할인·계곡 강수 가중·미먼 민감군)
  const thermalPts = Math.round(tb.deductions.thermal * env.heat);
  // 강수(쾌적, TCI) — 비로 관광이 불편한 정도. 침수·급류 위험은 안전층 호우로 분리.
  // KTCI 강수 32%·풍속 11.6%가 별개 가중이므로 요인도 강수·바람으로 나눠 표시(근거 일치).
  const rainPts = Math.min(WEATHER_MAX.rain, Math.round(tb.deductions.rain * env.rain));
  const windPts = Math.min(WEATHER_MAX.wind, Math.round(tb.deductions.wind * env.wind));
  const pmPts = Math.round(tb.deductions.pm * env.pm * (prof.pmSensitive ? 1.4 : 1));
  // 호우 severity(침수·급류) — 안전층으로 이동. 쾌적(TCI)은 5mm에서 포화하나
  // 호우주의보(30~60mm)·경보(90mm)는 위험이라 별도 축. 지형(env.rain)에 비례.
  const heavyRain =
    input.rainMm === undefined
      ? 0
      : input.rainMm >= 90
        ? 16
        : input.rainMm >= 60
          ? 11
          : input.rainMm >= 30
            ? 6
            : 0;
  const heavyRainPts = Math.min(HEAVY_RAIN_MAX, Math.round(heavyRain * env.rain));
  // 일조(하늘상태 SKY 환산) — 데이터 있을 때만 요인 추가. 야외 심미(실내 할인 env.heat).
  // 강수확률이 높으면 흐림은 강수 축이 이미 반영 → 일조 중복 감점을 줄인다(이중 페널티 방지).
  // 밴드는 강수 밴드(30/60)와 일치. 강수확률 결측이면 정보 없음 → 계수 1.0.
  const sunRainAdj =
    input.rainProbPct === undefined
      ? 1
      : input.rainProbPct >= 60
        ? 0
        : input.rainProbPct >= 30
          ? 0.5
          : 1;
  const sunPts = Math.round(tb.deductions.sun * env.heat * sunRainAdj);

  const thermalNote =
    feelsBase >= 33 ? "무더위" : feelsBase <= 4 ? "추위" : feelsBase >= 28 ? "더움" : "쾌적";
  const thermalLabel =
    input.apparentTempC !== undefined
      ? `체감 ${input.apparentTempC}℃(기온 ${input.tempC}℃)`
      : `체감온도 ${input.tempC}℃`;
  factors.push({
    key: "heat",
    label: "체감온도",
    value: feelsBase,
    unit: "℃",
    threshold: 33,
    points: thermalPts,
    maxPoints: WEATHER_MAX.thermal,
    level: levelForPoints(thermalPts, WEATHER_MAX.thermal),
    description: `${thermalLabel} — ${thermalNote}${prof.heatShiftC > 0 ? " · 동반 민감 기준" : ""} (관광기후지수 열쾌적)`,
  });
  factors.push({
    key: "rain",
    label: "강수",
    value: input.rainProbPct,
    unit: "%",
    threshold: 60,
    points: rainPts,
    maxPoints: WEATHER_MAX.rain,
    level: levelForPoints(rainPts, WEATHER_MAX.rain),
    description: `강수확률 ${input.rainProbPct}%${
      input.rainMm !== undefined && input.rainMm >= 3 ? ` · ${input.rainMm}mm` : ""
    } (관광기후지수 강수)`,
  });
  // 바람 요인 — 풍속 데이터 있을 때만 표시(없으면 TCI 4축 재정규화라 감점 0).
  // 중기예보(D+4~)는 풍속을 제공하지 않는다.
  if (input.windMs !== undefined) {
    factors.push({
      key: "wind",
      label: "바람",
      value: input.windMs,
      unit: "m/s",
      threshold: 9,
      points: windPts,
      maxPoints: WEATHER_MAX.wind,
      level: levelForPoints(windPts, WEATHER_MAX.wind),
      description: `풍속 ${input.windMs}m/s (관광기후지수 풍속)`,
    });
  }
  factors.push({
    key: "pm",
    label: "미세먼지",
    value: input.pm25,
    unit: "㎍/㎥",
    threshold: 35,
    points: pmPts,
    maxPoints: WEATHER_MAX.pm,
    level: levelForPoints(pmPts, WEATHER_MAX.pm),
    description: `PM2.5 ${input.pm25}㎍/㎥ — 환경부 '${pmGradeLabel(input.pm25)}' 등급${prof.pmSensitive ? " · 민감군 기준" : ""}`,
  });

  // 일조 요인 — SKY 데이터 있을 때만 표시(없으면 TCI 4축 재정규화라 감점 0)
  if (input.sunHours !== undefined) {
    factors.push({
      key: "sun",
      label: "일조",
      value: input.sunHours,
      unit: "h",
      threshold: 5,
      points: sunPts,
      maxPoints: WEATHER_MAX.sun,
      level: levelForPoints(sunPts, WEATHER_MAX.sun),
      description: `낮 하늘상태 환산 일조 ${input.sunHours}시간 — ${
        input.sunHours >= 8 ? "맑음" : input.sunHours >= 4 ? "구름많음" : "흐림"
      } (관광기후지수)${sunRainAdj < 1 ? " · 강수확률 높아 감점 완화(강수 축 반영)" : ""}`,
    });
  }

  const weatherRisk = thermalPts + rainPts + windPts + pmPts + sunPts;

  // ── 안전층: 호우 침수·급류 (기상청 호우 특보 severity) ──
  // 강수 불쾌(쾌적 TCI)와 층을 분리 — "강수가 왜 두 번 깎이나"를 제거하고, 위험은
  // 안전층에서 산사태 프록시와 함께 다룬다. rainMm<30(호우 미만)이면 요인 없음.
  if (heavyRainPts > 0) {
    const hrLabel =
      (input.rainMm ?? 0) >= 90 ? "경보급" : (input.rainMm ?? 0) >= 60 ? "주의보급" : "예비급";
    factors.push({
      key: "heavy_rain",
      label: "호우",
      value: input.rainMm ?? 0,
      unit: "mm",
      threshold: 30,
      points: heavyRainPts,
      maxPoints: HEAVY_RAIN_MAX,
      level: levelForPoints(heavyRainPts, HEAVY_RAIN_MAX),
      description: `일강수 ${input.rainMm}mm — 기상청 호우 ${hrLabel} 침수·급류 위험`,
    });
  }

  // ── 안전층: 산불 (산림청 단계 → 여행 권고 등급 앵커) ──
  // 등급 감점(0/15/45/80)이 100점 만점 기준이라 그 자체가 등급을 보장(높음→≤55, 매우높음→≤20).
  // 실내 할인(env) 미적용: 매우높음은 대피·통제급이라 지형과 무관하게 방문자제여야 한다.
  const fireLevel = normalizeForestFireLevel(input.forestFireLevel);
  const fire = Math.round(Math.min(FOREST_FIRE.MAX_POINTS, forestFirePoints(fireLevel)));
  const fireNote = fireLevel >= 4 ? " → 방문 자제" : fireLevel >= 3 ? " → 주의" : "";
  factors.push({
    key: "forest_fire",
    label: "산불",
    value: fireLevel,
    unit: "단계",
    threshold: 3,
    points: fire,
    maxPoints: FOREST_FIRE.MAX_POINTS,
    level: levelForPoints(fire, FOREST_FIRE.MAX_POINTS),
    description: `산불위험 ${fireLevel}단계 — 산림청 '${FOREST_FIRE.LEVEL_LABEL[fireLevel]}'${fireNote}`,
  });

  // ── 안전층: 산사태 (강우×지형 프록시, 공식 발령 상향 override) ──
  const proxyLevel = landslideProxyLevel(input.rainMm, place.envType);
  const landslideLevel = Math.max(proxyLevel, input.landslideLevel ?? 0) as 0 | 1 | 2;
  let landslide = 0;
  if (landslideLevel > 0) {
    landslide = Math.round(Math.min(LANDSLIDE.MAX_POINTS, landslidePoints(landslideLevel)));
    const official = (input.landslideLevel ?? 0) >= landslideLevel;
    const lsNote = landslideLevel >= 2 ? " → 방문 자제" : " → 주의";
    const src = official ? "산림청 예보발령" : "예보 강수량·지형 기반 추정";
    factors.push({
      key: "landslide",
      label: "산사태",
      value: landslideLevel,
      unit: "단계",
      threshold: 1,
      points: landslide,
      maxPoints: LANDSLIDE.MAX_POINTS,
      level: levelForPoints(landslide, LANDSLIDE.MAX_POINTS),
      description: `산사태 ${LANDSLIDE.LEVEL_LABEL[landslideLevel]} — ${src}${lsNote}`,
    });
  }

  // ── 안전층: 응급의료 접근성 (취약성) ──
  const medical = Math.round(
    Math.min(MEDICAL.MAX_POINTS, medicalPoints(input.emergencyRoomKm) * prof.medical),
  );
  factors.push({
    key: "medical",
    label: "응급의료",
    value: input.emergencyRoomKm,
    unit: "km",
    threshold: MEDICAL.NEAR_KM,
    points: medical,
    maxPoints: MEDICAL.MAX_POINTS,
    level: levelForPoints(medical, MEDICAL.MAX_POINTS),
    description: `최근접 응급의료기관 ${input.emergencyRoomKm}km — 골든타임 권장(${MEDICAL.NEAR_KM}km) ${
      input.emergencyRoomKm > MEDICAL.NEAR_KM ? "초과" : "이내"
    }`,
  });

  // ── 대피소 (선택 입력) ──
  let shelter = 0;
  if (input.shelterKm !== undefined) {
    shelter = Math.round(Math.min(SHELTER.MAX_POINTS, shelterPoints(input.shelterKm)));
    factors.push({
      key: "shelter",
      label: "대피소",
      value: input.shelterKm,
      unit: "km",
      threshold: SHELTER.WALKABLE_KM,
      points: shelter,
      maxPoints: SHELTER.MAX_POINTS,
      level: levelForPoints(shelter, SHELTER.MAX_POINTS),
      description: `최근접 대피소 ${input.shelterKm}km — 도보 접근권(${SHELTER.WALKABLE_KM}km) ${
        input.shelterKm > SHELTER.WALKABLE_KM ? "초과" : "이내"
      }`,
    });
  }

  // ── 합산: score = 100 − (쾌적 + 안전) ──
  // 재난 단계 감점이 등급컷에 앵커돼 있어(높음 45→≤55 주의, 매우높음/경보 80→≤20 방문자제)
  // 별도 override 없이 감점 합만으로 등급이 보장된다. 점수 = 100−감점 합(항상 일치).
  const disasterRisk = heavyRainPts + fire + landslide + shelter;
  const medicalRisk = medical;
  const total = weatherRisk + disasterRisk + medicalRisk;
  const score = Math.max(0, Math.min(100, 100 - total));

  return {
    score,
    grade: gradeForScore(score),
    profile,
    factors,
    weatherRisk,
    disasterRisk,
    medicalRisk,
  };
}
