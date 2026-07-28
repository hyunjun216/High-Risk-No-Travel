/**
 * 안전 점수 가중치·임계값 상수 — 모든 수치는 공공기관 공식 발표 기준을 근거로 한다.
 *
 * 산식(제안서): SafetyScore = 100 - (WeatherRisk + DisasterRisk + MedicalRisk + MobilityRisk)
 * 감점 상한(제안서 표): 폭염 25 / 강수·강풍 20 / 미세먼지 15 / 산불 20 / 산사태 15 /
 *                      응급의료 10 / 대피소 10 / 이동 위험 10(2주차)
 * (제안서의 '산불·산사태 20'을 산불(건조)·산사태(강우) 상반 재해로 분리 — 동시 발생 희박)
 */
import type { Profile, RiskLevel } from "@/lib/safety/types";
import type { PlaceEnvType } from "@/lib/tour/types";

// ─────────────────────────────────────────────
// 폭염 (상한 25)
// ─────────────────────────────────────────────
// 입력은 체감온도(apparentTempC) 우선 — score.ts의 heatEvalC 참조
export const HEAT = {
  /** 기상청 폭염주의보 발표 기준: 일 최고 체감온도 33℃ 이상 지속 예상 */
  ADVISORY_C: 33,
  /** 기상청 폭염경보 발표 기준: 일 최고 체감온도 35℃ 이상 지속 예상 */
  WARNING_C: 35,
  /** 33℃ 미만 저감점 구간의 시작(28℃부터 완만히 상승) */
  RAMP_START_C: 28,
  MAX_POINTS: 25,
} as const;

/**
 * 최고기온(℃) → 폭염 기본 감점. 주의보(33℃)에서 중간, 경보(35℃)부터 상한 근접.
 * shiftC(민감층 임계값 하향): 기상청 폭염 영향예보가 취약계층(어린이·노약자)을
 * 일반인보다 낮은 체감온도에서 위험 단계에 진입시키는 구조를 차용 —
 * 곡선 전체를 shiftC만큼 왼쪽으로 이동시킨다 (= tempC + shiftC 지점에서 평가).
 */
export function heatPoints(tempC: number, shiftC = 0): number {
  const t = tempC + shiftC;
  if (t < HEAT.RAMP_START_C) return 0;
  if (t < HEAT.ADVISORY_C) {
    // 28~33℃: 0 → 8점 완만 상승 (저감점)
    return ((t - HEAT.RAMP_START_C) / (HEAT.ADVISORY_C - HEAT.RAMP_START_C)) * 8;
  }
  if (t < HEAT.WARNING_C) {
    // 폭염주의보 구간 33~35℃: 12 → 22점
    return 12 + (t - HEAT.ADVISORY_C) * 5;
  }
  // 폭염경보 35℃+: 22점에서 시작해 상한 25점까지
  return Math.min(HEAT.MAX_POINTS, 22 + (t - HEAT.WARNING_C) * 1.5);
}

// ─────────────────────────────────────────────
// 강수·강풍 (합산 상한 20)
// ─────────────────────────────────────────────
export const RAIN_WIND = {
  /** 기상청 단기예보 강수확률 구간: 30% 이상부터 '비 가능성' 안내 통용 */
  PROB_LOW_PCT: 30,
  PROB_MID_PCT: 60,
  PROB_HIGH_PCT: 80,
  /** 기상청 호우주의보 발표 기준: 3시간 강수량 60mm 이상 예상 */
  HEAVY_RAIN_MM: 60,
  /** 호우주의보의 절반 수준 — 우산·우비 필수 구간으로 가점 */
  MODERATE_RAIN_MM: 30,
  /** 기상청 강풍주의보 발표 기준: 육상 풍속 14m/s 이상 예상 */
  WIND_ADVISORY_MS: 14,
  /** 강풍주의보 미만이지만 체감 위험이 커지는 풍속(주의보 기준의 약 2/3) */
  WIND_CAUTION_MS: 9,
  MAX_POINTS: 20,
} as const;

/** 강수확률(%) + 예상 강수량(mm) → 강수 기본 감점 (0~18) */
export function rainPoints(rainProbPct: number, rainMm?: number): number {
  let pts = 0;
  if (rainProbPct >= RAIN_WIND.PROB_HIGH_PCT) pts = 12;
  else if (rainProbPct >= RAIN_WIND.PROB_MID_PCT) pts = 8;
  else if (rainProbPct >= RAIN_WIND.PROB_LOW_PCT) pts = 4;
  if (rainMm !== undefined) {
    if (rainMm >= RAIN_WIND.HEAVY_RAIN_MM) pts += 6;
    else if (rainMm >= RAIN_WIND.MODERATE_RAIN_MM) pts += 3;
  }
  return pts;
}

/** 풍속(m/s) → 강풍 기본 감점 (0~8) */
export function windPoints(windMs: number): number {
  if (windMs >= RAIN_WIND.WIND_ADVISORY_MS) return 8;
  if (windMs >= RAIN_WIND.WIND_CAUTION_MS) return 4;
  return 0;
}

// ─────────────────────────────────────────────
// 미세먼지 (상한 15)
// ─────────────────────────────────────────────
/** 환경부 초미세먼지(PM2.5) 예보 등급 기준(㎍/㎥): 좋음 0~15, 보통 16~35, 나쁨 36~75, 매우나쁨 76+ */
export const PM25 = {
  GOOD_MAX: 15,
  MODERATE_MAX: 35,
  BAD_MAX: 75,
  MAX_POINTS: 15,
} as const;

export const PM25_GRADE_LABEL = {
  good: "좋음",
  moderate: "보통",
  bad: "나쁨",
  very_bad: "매우나쁨",
} as const;

/**
 * PM2.5(㎍/㎥) → 미세먼지 기본 감점.
 * sensitive(민감군 곡선): EPA AQI의 "민감군에게 나쁨(USG)" 구조 차용 —
 * 같은 농도에서 민감군(아이 동반)은 한 단계 이른 감점 (보통 3→5, 나쁨 8→12).
 */
export function pmPoints(pm25: number, sensitive = false): number {
  if (pm25 <= PM25.GOOD_MAX) return 0;
  if (pm25 <= PM25.MODERATE_MAX) return sensitive ? 5 : 3;
  if (pm25 <= PM25.BAD_MAX) return sensitive ? 12 : 8;
  return PM25.MAX_POINTS;
}

export function pmGradeLabel(pm25: number): string {
  if (pm25 <= PM25.GOOD_MAX) return PM25_GRADE_LABEL.good;
  if (pm25 <= PM25.MODERATE_MAX) return PM25_GRADE_LABEL.moderate;
  if (pm25 <= PM25.BAD_MAX) return PM25_GRADE_LABEL.bad;
  return PM25_GRADE_LABEL.very_bad;
}

// ─────────────────────────────────────────────
// 산불 — 단계를 여행 권고 등급에 앵커 (100점 만점 기준이라 감점 자체가 등급 보장)
//   낮음 0 / 다소높음 15(밴드) / 높음 45→총점 ≤55(주의) / 심각(매우높음) 80→≤20(방문자제)
//   근거: 단계=산림청 4단계(공식) · 순서=발생확률 실증(낮음2.06<다소높음9.70<높음15.37<
//   매우높음27.41%, 한국산림과학회지 2025) · 절대값=등급컷 앵커(밴드값은 민감도 분석으로 방어)
// ─────────────────────────────────────────────
/** 산림청 산불위험예보 4단계: 1 낮음, 2 다소높음, 3 높음, 4 매우높음 */
export const FOREST_FIRE = {
  LEVEL_LABEL: { 1: "낮음", 2: "다소높음", 3: "높음", 4: "매우높음" } as Record<
    1 | 2 | 3 | 4,
    string
  >,
  /** 단계별 감점 — 높음(45)·매우높음(80)은 주의·방문자제 등급에 도달하게 앵커 */
  POINTS_BY_LEVEL: { 1: 0, 2: 15, 3: 45, 4: 80 } as Record<1 | 2 | 3 | 4, number>,
  MAX_POINTS: 80,
} as const;

/** 외부 API 이상치(0, 5 등) 유입 시 NaN 전파 방지 — 1~4로 clamp */
export function normalizeForestFireLevel(level: number): 1 | 2 | 3 | 4 {
  const n = Math.round(level);
  return (n < 1 ? 1 : n > 4 ? 4 : n) as 1 | 2 | 3 | 4;
}

export function forestFirePoints(level: number): number {
  return FOREST_FIRE.POINTS_BY_LEVEL[normalizeForestFireLevel(level)];
}

// ─────────────────────────────────────────────
// 산사태 (Disaster, 상한 80 — 경보를 방문자제 등급에 앵커) — 강우×지형 프록시 + 산림청 예보발령 override
// ─────────────────────────────────────────────
/**
 * 산사태 위험 0~2 (0 없음 / 1 주의보 수준 / 2 경보 수준).
 * 근거: 산림청 산사태정보시스템 예보발령은 토양함수지수(누적 강우로 산정한 토양 속
 *   빗물량)로 발령한다 — 권역 토양함수지수 80% 도달 시 주의보, 100% 시 경보.
 *   실시간 예보발령 API(data.go.kr/15074798) 승인·전파 전까지는 예보 강수량과
 *   지형 취약도(급경사 산지·계곡 토석류)로 근사한다. 공식 발령이 들어오면
 *   score.ts가 max(프록시, 공식)으로 상향만 반영한다.
 *   산불(건조)과 산사태(강우)는 상반된 기상 조건에서 발생 → 동시에 높기 어렵다.
 */
export const LANDSLIDE = {
  LEVEL_LABEL: { 0: "없음", 1: "주의보 수준", 2: "경보 수준" } as Record<
    0 | 1 | 2,
    string
  >,
  /** 단계별 감점 — 발령을 여행 권고 등급에 앵커: 주의보 45→총점 ≤55(주의), 경보 80→≤20(방문자제) */
  POINTS_BY_LEVEL: { 0: 0, 1: 45, 2: 80 } as Record<0 | 1 | 2, number>,
  /** 일 강수량 트리거(mm) — 기상청 호우주의보(3h 60mm)·산사태 강우기준을 일강수로 근사 */
  WATCH_RAIN_MM: 40,
  WARN_RAIN_MM: 80,
  MAX_POINTS: 80,
} as const;

/**
 * 환경유형별 산사태 취약도 — 급경사 산지·계곡(토석류 경로)이 높고, 평지·해안은 낮으며
 * 실내는 직접 노출이 없다. envType이 경사·지형을 대리하는 프록시 신호다.
 */
const LANDSLIDE_SUSCEPTIBILITY: Record<PlaceEnvType, number> = {
  indoor: 0,
  outdoor_mountain: 1.0,
  outdoor_water: 0.9, // 계곡·수변 = 집중호우 시 토석류 경로
  outdoor_coast: 0.4,
  outdoor_general: 0.4,
};

/** 외부값(음수·3 등) 유입 시 0~2로 clamp */
export function normalizeLandslideLevel(level: number): 0 | 1 | 2 {
  const n = Math.round(level);
  return (n < 0 ? 0 : n > 2 ? 2 : n) as 0 | 1 | 2;
}

/**
 * 예보 강수량(mm)×지형 취약도 → 산사태 위험 프록시 0~2.
 * 취약도 낮은 지형(해안·평지)은 같은 비여도 사면 붕괴 위험이 낮아 한 단계 완화한다.
 */
export function landslideProxyLevel(
  rainMm: number | undefined,
  envType: PlaceEnvType,
): 0 | 1 | 2 {
  const s = LANDSLIDE_SUSCEPTIBILITY[envType];
  if (!rainMm || s <= 0) return 0;
  let level: 0 | 1 | 2 =
    rainMm >= LANDSLIDE.WARN_RAIN_MM ? 2 : rainMm >= LANDSLIDE.WATCH_RAIN_MM ? 1 : 0;
  if (s < 0.5 && level > 0) level = (level - 1) as 0 | 1 | 2;
  return level;
}

export function landslidePoints(level: number): number {
  return LANDSLIDE.POINTS_BY_LEVEL[normalizeLandslideLevel(level)];
}

// ─────────────────────────────────────────────
// 응급의료 접근성 (상한 10)
// ─────────────────────────────────────────────
/**
 * 중증 응급환자 골든타임 확보 기준 거리.
 * 보건복지부 응급의료 취약지 판정 기준(지역응급의료센터 30분/1시간 내 접근)을
 * 도로 이동거리로 환산해 10km 이내 양호 / 10~20km 주의 / 30km+ 취약으로 구간화.
 */
export const MEDICAL = {
  NEAR_KM: 10,
  MID_KM: 20,
  FAR_KM: 30,
  MAX_POINTS: 10,
} as const;

/** 최근접 응급의료기관 거리(km) → 기본 감점 */
export function medicalPoints(km: number): number {
  if (km >= MEDICAL.FAR_KM) return MEDICAL.MAX_POINTS;
  if (km > MEDICAL.MID_KM) {
    // 20~30km: 5 → 10점
    return 5 + ((km - MEDICAL.MID_KM) / (MEDICAL.FAR_KM - MEDICAL.MID_KM)) * 5;
  }
  if (km > MEDICAL.NEAR_KM) {
    // 10~20km: 2 → 5점
    return 2 + ((km - MEDICAL.NEAR_KM) / (MEDICAL.MID_KM - MEDICAL.NEAR_KM)) * 3;
  }
  // 10km 이내: 0 → 2점 (소량)
  return (km / MEDICAL.NEAR_KM) * 2;
}

// ─────────────────────────────────────────────
// 대피소 접근성 (상한 10, 입력 없으면 0점 — 불이익 금지)
// ─────────────────────────────────────────────
/**
 * 행정안전부 민방위 대피시설 지정 원칙(주거지에서 도보 5분 내외 접근 권장)을 준용해
 * 도보 접근 가능권 약 1km를 기준으로 구간화.
 */
export const SHELTER = {
  WALKABLE_KM: 1,
  NEAR_KM: 3,
  MID_KM: 5,
  MAX_POINTS: 10,
} as const;

/** 최근접 대피소 거리(km) → 기본 감점 */
export function shelterPoints(km: number): number {
  if (km <= SHELTER.WALKABLE_KM) return 0;
  if (km <= SHELTER.NEAR_KM) return 3;
  if (km <= SHELTER.MID_KM) return 6;
  return SHELTER.MAX_POINTS;
}

// ─────────────────────────────────────────────
// 환경 유형 가중 — TourAPI 카테고리 기반 자체 분류(PlaceEnvType)를 점수에 반영
// ─────────────────────────────────────────────
export interface EnvWeight {
  heat: number;
  rain: number;
  wind: number;
  pm: number;
  fire: number;
}

export const ENV_WEIGHT: Record<PlaceEnvType, EnvWeight> = {
  /** 실내는 기상 영향이 낮다. 산불도 직접 노출이 낮아 동일하게 0.3 —
   * 도심 상가 음식점이 시군 산불 단계를 그대로 감점받는 왜곡 방지 */
  indoor: { heat: 0.3, rain: 0.3, wind: 0.3, pm: 0.3, fire: 0.3 },
  /** 계곡·수변: 호우 시 급류·불어남 위험 */
  outdoor_water: { heat: 1.0, rain: 1.5, wind: 1.0, pm: 1.0, fire: 1.0 },
  /** 산악: 강풍·산불 위험 가중 */
  outdoor_mountain: { heat: 1.0, rain: 1.0, wind: 1.3, pm: 1.0, fire: 1.3 },
  /** 해안: 강풍 위험 가중 */
  outdoor_coast: { heat: 1.0, rain: 1.0, wind: 1.5, pm: 1.0, fire: 1.0 },
  outdoor_general: { heat: 1.0, rain: 1.0, wind: 1.0, pm: 1.0, fire: 1.0 },
};

// ─────────────────────────────────────────────
// 프로필 가중 (제안서 약속)
//
// 민감층(아이·부모님)의 기상 민감도는 배율(×1.3) 대신 "임계값 하향"으로 반영한다.
// 근거: 표준 위험지수들이 모두 이 구조를 쓴다 —
//  · 기상청 폭염 영향예보: 취약계층(어린이·노약자)은 일반인(주의보 33℃)보다 낮은
//    체감온도(31℃)부터 위험 단계 진입
//  · 미국 NWS HeatRisk: 민감군은 낮은 단계(Level 1~2)에서 먼저 영향
//  · 미국 EPA AQI: 101~150 = "민감군에게 나쁨(USG)" 전용 구간
// 배율 방식은 감점이 0인 온화한 날에 프로필 간 차이가 전혀 없다는 결함이 있었다.
// ─────────────────────────────────────────────
export interface ProfileWeight {
  heat: number;
  pm: number;
  medical: number;
  /** 폭염 임계값 하향 ℃ (민감층 2℃ — 영향예보 취약계층 관심단계 31℃ 근거) */
  heatShiftC: number;
  /** 미세먼지 민감군 곡선 사용 여부 (AQI USG 구조) */
  pmSensitive: boolean;
}

export const PROFILE_WEIGHT: Record<Profile, ProfileWeight> = {
  default: { heat: 1.0, pm: 1.0, medical: 1.0, heatShiftC: 0, pmSensitive: false },
  /** 아이 동반: 폭염 임계값 2℃ 하향 + 미세먼지 민감군 곡선 */
  with_kids: { heat: 1.0, pm: 1.0, medical: 1.0, heatShiftC: 2, pmSensitive: true },
  /** 부모님 동반: 응급의료 ×1.5 + 폭염 임계값 2℃ 하향 (노약자도 폭염 취약계층) */
  with_seniors: { heat: 1.0, pm: 1.0, medical: 1.5, heatShiftC: 2, pmSensitive: false },
  /** 아이·부모님 동시: 폭염 하향 + 미세먼지 민감(아이) + 응급의료 ×1.5(부모님) */
  with_kids_seniors: { heat: 1.0, pm: 1.0, medical: 1.5, heatShiftC: 2, pmSensitive: true },
};

// ─────────────────────────────────────────────
// 등급/레벨 컷
// ─────────────────────────────────────────────
/** 점수 등급 컷: 70 이상 low(주의 요인 낮음), 40~69 moderate, 40 미만 high */
export function gradeForScore(score: number): RiskLevel {
  if (score >= 70) return "low";
  if (score >= 40) return "moderate";
  return "high";
}

/** 요인 레벨: 감점/상한 비율 1/3 미만 low, 2/3 미만 moderate, 이상 high */
export function levelForPoints(points: number, maxPoints: number): RiskLevel {
  const ratio = maxPoints > 0 ? points / maxPoints : 0;
  if (ratio < 1 / 3) return "low";
  if (ratio < 2 / 3) return "moderate";
  return "high";
}

// ─────────────────────────────────────────────
// 대체지 추천(reco) 임계값 — 안전점수에 거는 기준이므로 이 파일에서 관리
// ─────────────────────────────────────────────
/**
 * 의미 있는 개선으로 인정하는 최소 점수 차.
 * 근거: 반올림 오차(±1점)와 뚜렷이 구분되고, 등급 컷 간격(30점)의 1/6 수준 —
 * "체감되는 개선"의 설계값 (공공 기준 아님, 사용자 피드백으로 보정 예정).
 */
export const RECO_MIN_SCORE_GAIN = 5;

/**
 * '악천후'로 판단해 실내 후보를 우대하는 기상 감점 기준.
 * 근거: 기상 감점 상한 60점(폭염25+강수강풍20+미세먼지15)의 1/4 —
 * 특보 1개 초과분에 상당하는 설계값.
 */
export const RECO_WEATHER_RISK_INDOOR_THRESHOLD = 15;

// ─────────────────────────────────────────────
// 반나절 코스(course)·체크리스트(report) 임계값 — 안전점수에 거는 기준이므로 이 파일에서 관리
// ─────────────────────────────────────────────
/**
 * 코스에 포함하는 최소 안전점수.
 * 근거: 등급 컷 moderate 하한(40)과 low 하한(70)의 중간 — "주의 요인이 뚜렷하지 않은
 * 수준"의 설계값. 코스는 안내가 아니라 권유이므로 등급 low보다 완화된 컷 적용.
 */
export const COURSE_MIN_STOP_SCORE = 60;

/**
 * "주의 요인 있음(moderate)" 대상에서 대체지 중심 코스로 전환하는 최소 개선 폭.
 * 근거: 추천 노출 기준(RECO_MIN_SCORE_GAIN=5)의 2배 — 단순 노출보다 "일정 자체를
 * 바꾸라"는 더 강한 권고이므로 두 배의 확신을 요구하는 설계값.
 */
export const COURSE_ANCHOR_SWITCH_MIN_GAIN = 10;

/**
 * 산불 준비 문구를 띄우는 최소 단계.
 * 근거: 산림청 4단계 중 3단계('높음')부터 입산 통제·화기 단속이 통상 강화됨.
 */
export const CHECKLIST_FIRE_LEVEL = 3;
