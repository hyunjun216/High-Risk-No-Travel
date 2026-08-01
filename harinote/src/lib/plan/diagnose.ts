/**
 * 계획 안전 진단 — 서버 액션 DTO와 순수 헬퍼 (UI·액션 공용 계약).
 * 플래너에 담긴 스톱을 각 일차의 실제 날짜 기준으로 재채점한 결과를 나른다.
 */
import type {
  Profile,
  RiskBreakdown,
  RiskFactorKey,
  RiskLevel,
} from "@/lib/safety/types";
import type { Transport } from "@/lib/prefs";
import type { TravelPlan } from "@/lib/travel-plan";

/** 스톱 점수의 계산 근거 — today: 오늘 실황, forecast: 단기예보, seasonal: 30년 계절 통계 */
export type StopDiagnosisMode = "today" | "forecast" | "seasonal" | "unknown";

export const STOP_MODE_LABEL: Record<StopDiagnosisMode, string> = {
  today: "오늘 기준",
  forecast: "예보 기준",
  seasonal: "계절 통계 기준",
  unknown: "데이터 없음",
};

export interface StopAlternativeDto {
  contentId: number;
  title: string;
  lat: number;
  lng: number;
  score: number;
  distanceKm: number;
}

export interface StopDiagnosisDto {
  contentId: number;
  /** 1-based 일차 */
  day: number;
  /** 이 스톱이 평가된 날짜 (YYYY-MM-DD) */
  dateISO: string;
  mode: StopDiagnosisMode;
  /** unknown 모드면 null */
  score: number | null;
  grade: RiskLevel | null;
  /** 감점 큰 순 상위 요인 (표시용) */
  topFactors: { label: string; points: number }[];
  /**
   * 감점이 있는 전체 요인 (키 + 관측/예보값) — 계획 체크리스트 등 파생 계산용.
   * value가 필요한 이유: heat 키는 TCI 열쾌적이라 겨울 추위 감점도 heat로 나온다
   * (체감온도 값으로 더위/추위를 구분해야 준비물이 갈린다)
   */
  riskFactors: { key: RiskFactorKey; value: number }[];
  /** grade가 low가 아닐 때만 채워지는 교체 후보 */
  alternatives: StopAlternativeDto[];
}

/**
 * 진단 요청 스톱 상한 — 초과하면 서버 액션이 거절한다.
 * UI가 미리 안내하려면 이 값이 필요한데, "use server" 모듈은 async 함수만 export할 수
 * 있으므로 상수는 이 DTO 모듈에 둔다.
 */
export const MAX_STOPS = 40;

export interface PlanDiagnosisDto {
  stops: StopDiagnosisDto[];
  /** 진단 기준 출발일 — 출발일 미설정이면 오늘 */
  baseISO: string;
  /** 출발일이 없어 "오늘 출발"로 가정했는지 (UI 안내용) */
  assumedToday: boolean;
  /** grade가 low가 아닌 스톱 수 */
  riskyCount: number;
}

/** 감점이 있는 요인을 큰 순으로 상위 n개 (표시용) */
export function topRiskFactors(
  breakdown: RiskBreakdown,
  n = 2,
): { label: string; points: number }[] {
  return breakdown.factors
    .filter((f) => f.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, n)
    .map((f) => ({ label: f.label, points: f.points }));
}

/**
 * 진단 무효화 판정용 서명 — 스톱 구성·일차·출발일·프로필·이동수단이 바뀌면
 * 기존 진단 결과는 낡은 것으로 취급한다 (순서 변경은 점수에 영향 없어 제외).
 */
export function planSignature(
  plan: TravelPlan,
  profile: Profile,
  transport: Transport,
): string {
  const items = [...plan.items]
    .map((it) => [it.contentId, it.day ?? 1] as const)
    .sort((a, b) => a[0] - b[0]);
  return JSON.stringify([items, plan.from ?? "", profile, transport]);
}
