/**
 * 관광기후지수(TCI/KTCI) 쾌적층 — 날씨가 "관광하기 좋은가"를 0~100으로.
 *
 * 근거:
 * - Mieczkowski(1985) TCI = 2(4·Cid + Cia + 2·R + 2·S + W), 각 세부지수 -3~5점
 * - 박창용 외(2014) 치악산 TCI 연구: 강수·일조·바람 변환표 원문
 * - 김남조 외 한국형 KTCI: 4계절 통합 실증 가중치(최고기온25.9·평균기온20.9·
 *   강수32.2·풍속11.6·구름9.5%) → 원 40/10/20/20/10 대체
 * - 미세먼지(pm)는 KTCI에 없는 우리 확장 — 등급 경계는 환경부 기준이지만
 *   가중(22%)은 설계값이다. 정확한 구성은 TCI_WEIGHTS 주석 참조
 *
 * 설계 메모(정직):
 * - Cid/Cia(열쾌적) ASHRAE 격자표는 원문 그림이라 텍스트 미확보 → 우리가 이미
 *   계산하는 체감온도(feelsLikeSummerC)로 브리지한다. 체감온도가 이미 기온+습도를
 *   합친 값이라 Cid/Cia의 취지(고온다습에서 급감)를 그대로 담는다. v1은 주간/일
 *   쾌적을 하나의 thermal(40%)로 합친다(일평균 기온·습도 미보유).
 * - 일조(S)는 예보 하늘상태(SKY) 확보 전까지 선택 입력 — 없으면 나머지로 재정규화.
 * - TCI는 쾌적도 지표일 뿐 사고·방문수를 예측하지 않는다(원논문 명시). 안전은 별도 층.
 */

/** 세부지수 0~5(일부 -3까지) → 서비스 표준화용. 각 함수는 순수. */

/**
 * 열쾌적 점수(-3~5) — 체감온도(℃)를 ASHRAE 안락 구간에 매핑.
 * 18~25℃ 최적(5), 고온다습(체감↑)·혹한에서 급감. Cid/Cia 격자표의 근사.
 */
export function thermalScore(feelsC: number): number {
  const t = feelsC;
  if (t >= 37) return -3;
  if (t >= 35) return -1;
  if (t >= 33) return 1;
  if (t >= 31) return 2;
  if (t >= 28) return 3;
  if (t >= 25) return 4;
  if (t >= 18) return 5; // 이상적
  if (t >= 15) return 4;
  if (t >= 10) return 3;
  if (t >= 5) return 2;
  if (t >= 0) return 1;
  if (t >= -5) return -1;
  return -3;
}

/**
 * 강수 점수(0~5) — 강수량·강수확률 중 나쁜 쪽 반영.
 * - 강수량(mm): 박창용(2014) 일값 규칙 — 5mm↑=0, 0.5mm 줄 때마다 +0.5, <0.5mm=5
 * - 강수확률(%): 예보 강수량이 없어도(강수없음) 비 가능성이 높으면 감점 —
 *   여행 계획 리스크 반영. 기상청 통용 구간(30/60/80%)을 점수로 역환산.
 * 예보는 "강수확률 60% + 강수없음"이 흔해, 확률을 빼면 비 예보가 감점에 안 잡힌다.
 */
export function rainScore(
  rainMmDaily: number | undefined,
  rainProbPct?: number,
): number {
  const r = rainMmDaily ?? 0;
  const byAmount = r >= 5 ? 0 : r < 0.5 ? 5 : 5 - r;
  let byProb = 5;
  if (rainProbPct !== undefined) {
    if (rainProbPct >= 80) byProb = 2;
    else if (rainProbPct >= 60) byProb = 3;
    else if (rainProbPct >= 30) byProb = 4;
  }
  return Math.min(byAmount, byProb);
}

/**
 * 일조 점수(0~5) — 일조시간(h). ≤1h=0, 1h당 +0.5, >10h=5.
 */
export function sunScore(sunHours: number): number {
  if (sunHours <= 1) return 0;
  return Math.min(5, (sunHours - 1) * 0.5);
}

/**
 * 바람 점수(0~5) — 풍속(m/s)을 km/h로 환산 후 Mieczkowski normal system 표.
 */
export function windScore(windMs: number): number {
  const kmh = windMs * 3.6;
  if (kmh < 2.88) return 5.0;
  if (kmh < 5.76) return 4.5;
  if (kmh < 9.04) return 4.0;
  if (kmh < 12.24) return 3.5;
  if (kmh < 19.8) return 3.0;
  if (kmh < 24.3) return 2.5;
  if (kmh < 28.8) return 2.0;
  if (kmh < 38.52) return 1.0;
  return 0;
}

/**
 * 미세먼지 점수(0~5) — 우리 확장. 환경부 PM2.5 등급 경계(㎍/㎥) 15/35/75.
 * 좋음=5, 보통=3.5, 나쁨=1.5, 매우나쁨=0.
 *
 * sensitive(민감군 곡선, 아이 동반): 같은 농도를 더 크게 감점한다.
 * 근거 = 미국 EPA AQI의 "민감군에게 나쁨(USG)" 전용 구간 구조 +
 *   analysis/NOTE_민감층_임계값.md 채택 스펙("보통 3→5, 나쁨 8→12, 좋음은 0 유지").
 *   배율(×1.4)이 아니라 곡선이어야 하는 이유도 그 문서에 있다 — 배율은 감점이 0인
 *   깨끗한 날 프로필 차이를 못 만들고, 상한 구간에서는 배점을 넘겨버린다.
 *
 * 스펙의 배(보통 5/3, 나쁨 12/8)를 이 축의 감점 비율에 적용하면 보통 0.3→0.5,
 * 나쁨 0.7→1.05가 된다. 나쁨은 상한(1.0)을 넘어 매우나쁨과 같아지므로 밴드 순서가
 * 유지되도록 0.9로 둔다 — 이 한 값만 설계값이다.
 */
export function pmScore(pm25: number, sensitive = false): number {
  if (pm25 <= 15) return 5; // 좋음 — 스펙대로 민감군도 감점 0
  if (pm25 <= 35) return sensitive ? 2.5 : 3.5;
  if (pm25 <= 75) return sensitive ? 0.5 : 1.5;
  return 0; // 매우나쁨 — 둘 다 축 상한
}

/** TCI 입력 — RiskInput에서 조립. windMs·sunHours는 선택(예보가 안 주면 축 제외). */
export interface TciInput {
  feelsC: number;
  rainMmDaily?: number;
  /** 강수확률 % — 예보 강수량이 없어도 비 가능성이 높으면 강수 감점에 반영 */
  rainProbPct?: number;
  /** 풍속 m/s — 중기예보 미제공. 없으면 wind 축 제외 후 재정규화(sunHours와 동일) */
  windMs?: number;
  pm25: number;
  /** 민감군(아이 동반) 곡선 사용 — 배점은 그대로 두고 감점 곡선만 바뀐다 */
  pmSensitive?: boolean;
  sunHours?: number;
}

/**
 * KTCI(한국형) 실증가중 + 미세먼지 확장. 합=1.
 *
 * 구성 방식: **미세먼지 22%를 먼저 떼고, 남은 78%를 KTCI 원가중 비율로 나눈다.**
 *   KTCI 원가중(김남조 외) = 최고기온 25.9 + 평균기온 20.9 ≈ 46.8(열쾌적) ·
 *   강수 32.2 · 풍속 11.6 · 구름 9.5 (합 100.1)
 *   → 0.78 × 46.8/100.1 = 0.365 → 0.36 · 32.2/100.1 → 0.25 · 11.6/100.1 → 0.09 ·
 *     9.5/100.1 = 0.074 → 0.08 (합이 정확히 1이 되도록 일조만 올림)
 *
 * ⚠ **22%는 설계값이다**(analysis/25_safety_evidence_map.md ❌). KTCI에 없는 축이라
 *   실증 근거가 없고, 한국의 황사·미세먼지 비중을 반영한 판단이다. 축의 등급 경계
 *   (15/35/75)만 환경부 기준으로 확실하다. 축 간 상대가중은 KTCI 비율을 보존한다.
 */
export const TCI_WEIGHTS = {
  thermal: 0.36, // KTCI 열쾌적(주간+일) → 체감온도 브리지
  rain: 0.25, // KTCI 강수 32.2%
  pm: 0.22, // 우리 확장 — 한국 황사·미세먼지 비중 상향(환경부 등급)
  wind: 0.09, // KTCI 풍속 11.6%
  sun: 0.08, // KTCI 구름/일사 9.5%
} as const;

/** 축 키 — 가중·정의역·계산 순회의 단일 목록 */
const AXES = ["thermal", "rain", "pm", "wind", "sun"] as const;
type Axis = (typeof AXES)[number];
/** 축 가중 — 민감도 분석이 설계값(pm 22%)을 교란할 때 덮어쓴다 */
export type TciWeights = Record<Axis, number>;

/**
 * 각 세부지수의 정의역. 열쾌적만 음수까지 간다 — Mieczkowski TCI의 세부지수가
 * -3~5이고, 고온다습·혹한을 "쾌적의 부재"가 아니라 "불쾌"로 표현하기 때문이다.
 * 나머지 축(강수·미먼·바람·일조)은 0이 바닥이다.
 *
 * 감점을 이 정의역으로 정규화해야 축 간 스케일이 맞는다. 전부 5로 나누면 열쾌적은
 * 음수 구간에서 배점을 넘어 잘리고(게이지 100% 초과), 잘린 뒤로는 더 더워져도
 * 감점이 안 늘어 민감층 차등이 사라진다.
 */
const SCORE_RANGE: Record<Axis, { min: number; max: number }> = {
  thermal: { min: -3, max: 5 },
  rain: { min: 0, max: 5 },
  pm: { min: 0, max: 5 },
  wind: { min: 0, max: 5 },
  sun: { min: 0, max: 5 },
};

/** 세부점수 → 0(최악)~1(이상적) */
function normalize(axis: Axis, score: number): number {
  const { min, max } = SCORE_RANGE[axis];
  return Math.max(0, Math.min(1, (score - min) / (max - min)));
}

function rawScores(input: TciInput): Record<Axis, number | undefined> {
  return {
    thermal: thermalScore(input.feelsC),
    rain: rainScore(input.rainMmDaily, input.rainProbPct),
    pm: pmScore(input.pm25, input.pmSensitive),
    wind: input.windMs !== undefined ? windScore(input.windMs) : undefined,
    sun: input.sunHours !== undefined ? sunScore(input.sunHours) : undefined,
  };
}

/**
 * 관광기후지수 0~100. 각 세부점수를 정의역으로 정규화해 가중합.
 * 일조·풍속 미제공 시 해당 가중을 빼고 나머지를 재정규화(정보 없는 축이 불이익 주지 않게).
 */
export function computeTci(input: TciInput, weights: TciWeights = TCI_WEIGHTS): number {
  const s = rawScores(input);
  let wSum = 0;
  let acc = 0;
  for (const axis of AXES) {
    const score = s[axis];
    if (score === undefined) continue; // 일조·풍속 결측 → 제외 후 재정규화
    acc += weights[axis] * normalize(axis, score);
    wSum += weights[axis];
  }
  return Math.round(wSum > 0 ? (acc / wSum) * 100 : 0);
}

/** 축별 감점(이상값 대비 부족분) — score.ts의 요인 표시용. thermal은 체감온도, rain·wind 분리. */
export interface TciBreakdown {
  tci: number;
  /** 각 축이 100점 만점에서 깎은 양(0~해당 축 배점). 합 = 100 − tci */
  deductions: Record<Axis, number>;
  /**
   * 각 축의 배점 = 정규화 가중 × 100. 결측 축이 있으면 나머지가 그만큼 커진다.
   * score.ts가 요인 표시 상한(maxPoints)으로 쓴다 — 정적 상수를 쓰면 재정규화된
   * 배점을 넘겨 게이지가 100%를 초과한다.
   */
  shares: Record<Axis, number>;
}

/**
 * TCI + 축별 감점 분해.
 * 축 감점 = 배점 × (1 − 정규화점수) → 정의상 0~배점 안에 들어오고, 합이 100−tci와 같다.
 */
export function computeTciBreakdown(
  input: TciInput,
  weights: TciWeights = TCI_WEIGHTS,
): TciBreakdown {
  const raw = rawScores(input);
  let wSum = 0;
  for (const axis of AXES) if (raw[axis] !== undefined) wSum += weights[axis];

  const deductions = { thermal: 0, rain: 0, pm: 0, wind: 0, sun: 0 };
  const shares = { thermal: 0, rain: 0, pm: 0, wind: 0, sun: 0 };
  for (const axis of AXES) {
    const s = raw[axis];
    if (s === undefined || wSum === 0) continue;
    const share = (weights[axis] / wSum) * 100;
    shares[axis] = share;
    deductions[axis] = share * (1 - normalize(axis, s));
  }
  return { tci: computeTci(input, weights), deductions, shares };
}
