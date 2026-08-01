/**
 * 관광기후지수(TCI/KTCI) 쾌적층 — 날씨가 "관광하기 좋은가"를 0~100으로.
 *
 * 근거:
 * - Mieczkowski(1985) TCI = 2(4·Cid + Cia + 2·R + 2·S + W), 각 세부지수 -3~5점
 * - 박창용 외(2014) 치악산 TCI 연구: 강수·일조·바람 변환표 원문
 * - 김남조 외 한국형 KTCI: 4계절 통합 실증 가중치(최고기온25.9·평균기온20.9·
 *   강수32.2·풍속11.6·구름9.5%) → 원 40/10/20/20/10 대체
 * - 미세먼지(pm)는 KTCI에 없는 우리 확장(가중 15%, 환경부 PM 등급 근거)
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
 * 미세먼지 점수(0~5) — 우리 확장. 환경부 PM2.5 등급(㎍/㎥).
 * 좋음(≤15)=5, 보통(≤35)=3.5, 나쁨(≤75)=1.5, 매우나쁨=0.
 */
export function pmScore(pm25: number): number {
  if (pm25 <= 15) return 5;
  if (pm25 <= 35) return 3.5;
  if (pm25 <= 75) return 1.5;
  return 0;
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
  sunHours?: number;
}

/**
 * KTCI(한국형) + 미세먼지 가중. 합=1.
 * 열쾌적은 KTCI 최고기온25.9+평균기온20.9≈46.8을 하나로 합쳐 반영,
 * 미세먼지 15%를 얹고 전체를 재정규화한 값.
 */
export const TCI_WEIGHTS = {
  thermal: 0.36, // KTCI 열쾌적(주간+일) → 체감온도 브리지
  rain: 0.25, // KTCI 강수 32.2%
  pm: 0.22, // 우리 확장 — 한국 황사·미세먼지 비중 상향(환경부 등급)
  wind: 0.09, // KTCI 풍속 11.6%
  sun: 0.08, // KTCI 구름/일사 9.5%
} as const;

/**
 * 관광기후지수 0~100. 각 세부점수(-3~5)를 (s/5)로 정규화해 가중합 후 0~100 스케일.
 * 일조·풍속 미제공 시 해당 가중을 빼고 나머지를 재정규화(정보 없는 축이 불이익 주지 않게).
 */
export function computeTci(input: TciInput): number {
  const s = {
    thermal: thermalScore(input.feelsC),
    rain: rainScore(input.rainMmDaily, input.rainProbPct),
    pm: pmScore(input.pm25),
    wind: input.windMs !== undefined ? windScore(input.windMs) : undefined,
    sun: input.sunHours !== undefined ? sunScore(input.sunHours) : undefined,
  };

  let wSum = 0;
  let acc = 0;
  for (const key of ["thermal", "rain", "pm", "wind", "sun"] as const) {
    const score = s[key];
    if (score === undefined) continue; // 일조·풍속 결측 → 제외 후 재정규화
    const w = TCI_WEIGHTS[key];
    acc += w * (score / 5);
    wSum += w;
  }
  const norm = wSum > 0 ? acc / wSum : 0; // -0.6 ~ 1.0
  return Math.round(Math.max(0, Math.min(100, norm * 100)));
}

/** 축별 감점(이상값 대비 부족분) — score.ts의 요인 표시용. thermal은 체감온도, rain·wind 분리. */
export interface TciBreakdown {
  tci: number;
  /** 각 축이 100점 만점에서 깎은 양(0~축배점). 합은 대략 100−tci (음수 점수는 배점상한에서 clamp). */
  deductions: { thermal: number; rain: number; pm: number; wind: number; sun: number };
}

/**
 * TCI + 축별 감점 분해. 각 축 감점 = 정규화가중 × (5−점수)/5 × 100,
 * 0~해당 축 배점으로 clamp(음수 점수가 배점을 넘겨도 표시 상한은 배점).
 */
export function computeTciBreakdown(input: TciInput): TciBreakdown {
  const raw: Record<keyof TciBreakdown["deductions"], number | undefined> = {
    thermal: thermalScore(input.feelsC),
    rain: rainScore(input.rainMmDaily, input.rainProbPct),
    pm: pmScore(input.pm25),
    wind: input.windMs !== undefined ? windScore(input.windMs) : undefined,
    sun: input.sunHours !== undefined ? sunScore(input.sunHours) : undefined,
  };
  let wSum = 0;
  for (const k of ["thermal", "rain", "pm", "wind", "sun"] as const) {
    if (raw[k] !== undefined) wSum += TCI_WEIGHTS[k];
  }
  const deductions = { thermal: 0, rain: 0, pm: 0, wind: 0, sun: 0 };
  for (const k of ["thermal", "rain", "pm", "wind", "sun"] as const) {
    const s = raw[k];
    if (s === undefined || wSum === 0) continue;
    const share = (TCI_WEIGHTS[k] / wSum) * 100; // 축 배점(정규화)
    deductions[k] = Math.max(0, Math.min(share, share * ((5 - s) / 5)));
  }
  return { tci: computeTci(input), deductions };
}
