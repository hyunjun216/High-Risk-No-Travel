/**
 * 감점을 쾌적/안전 두 층으로 가르는 순수 로직 — RiskLayerSummary가 렌더한다.
 * 분류 근거와 "표시 전용"이라는 제약은 lib/safety/types.ts COMFORT_FACTOR_KEYS 주석 참고.
 */
import { COMFORT_FACTOR_KEYS, type RiskFactor } from "@/lib/safety/types";

export interface LayerTotals {
  comfort: number;
  safety: number;
}

/**
 * 요인 배열 → 층별 감점 합.
 * 쾌적 목록에 없는 키는 안전층으로 넣는다 — 새 위험 축이 추가됐을 때
 * 어느 쪽에도 안 잡혀 조용히 사라지는 것보다, 안전으로 과대 보고되는 편이 낫다.
 */
export function layerTotals(factors: RiskFactor[]): LayerTotals {
  let comfort = 0;
  let safety = 0;
  for (const f of factors) {
    if (COMFORT_FACTOR_KEYS.includes(f.key)) comfort += f.points;
    else safety += f.points;
  }
  return { comfort, safety };
}
