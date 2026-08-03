/**
 * 감점을 쾌적층/안전층으로 가르는 순수 로직.
 *
 * 분류 근거는 lib/safety/types.ts COMFORT_FACTOR_KEYS 주석 참고.
 * 쓰는 곳은 코스 스톱 자격 판정(course/*) 하나뿐이다 — 화면은 총점과 요인별 내역만
 * 보여주고 층을 나누지 않는다. 사용자에게 감점은 하나다.
 */
import { COMFORT_FACTOR_KEYS, type RiskBreakdown, type RiskFactor } from "@/lib/safety/types";
import { COURSE_MIN_STOP_SCORE } from "@/lib/safety/weights";

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

/**
 * 코스 스톱 후보 자격 — **안전층 감점만으로** 최소 점수를 넘는가.
 *
 * 왜 총점이 아닌가: 총점 기준이면 "추워서 60점 미만"과 "산불 위험해서 60점 미만"이
 * 똑같이 걸린다. 실측(계절 모드 통상일, 야외 관광지 기준):
 *   · 12월 — 후보 **0곳**. 추위 감점만으로 총점이 60 아래로 떨어져 관광지가 전멸하고
 *     코스가 음식점·카페로만 채워졌다
 *   · 1월 — 320곳 (전체 758곳 중)
 * 안전층 기준으로 바꾸면 12월 758곳·1월 758곳으로 회복되고, **산불 3단계인 2~4월은
 * 여전히 0곳**이다(야외 안전 감점 58 > 40). 즉 제외 사유가 "위험"으로 좁혀진다.
 *
 * 임계값은 COURSE_MIN_STOP_SCORE(60)를 그대로 쓴다 — 새 설계값을 만들지 않고
 * 기존 컷의 **비교 대상만** 총점에서 안전층으로 옮긴 것이다.
 */
export function meetsCourseSafety(breakdown: RiskBreakdown): boolean {
  return 100 - layerTotals(breakdown.factors).safety >= COURSE_MIN_STOP_SCORE;
}
