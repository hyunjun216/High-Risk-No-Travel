/**
 * 시군 안전 지도 choropleth 색 — 등급 hue 안에서 안전점수로 명암을 편다 (sequential).
 * 지도(RegionRiskMapInner)와 범례(RegionDashboard)가 같은 색을 쓰도록 단일 정의.
 */
import type { RiskLevel } from "@/lib/safety/types";
import { GRADE_SCORE_RANGE } from "@/lib/safety/weights";

/** 등급별 색상(hue·채도) — SafetyScoreBadge의 emerald/amber/red 체계와 정렬 */
export const GRADE_HSL: Record<RiskLevel, { h: number; s: number }> = {
  low: { h: 158, s: 64 }, // emerald 계열
  moderate: { h: 38, s: 90 }, // amber 계열
  high: { h: 2, s: 78 }, // red 계열
};

/**
 * 등급 안에서 색상(hue)을 함께 편다 — 명암만 바꾸면 좋은 날(전 시군 85~95점)에
 * 지도가 단색 초록으로 보여 시군 간 비교가 불가능했다.
 * low: 황록(70점) → 진초록(100점) / moderate: 주황 → 앰버 / high: 진빨강 → 다홍
 */
const GRADE_HUE_RANGE: Record<RiskLevel, [number, number]> = {
  low: [72, 158],
  moderate: [22, 45],
  high: [2, 16],
};

export const NO_DATA_HEX = "#94a3b8"; // slate-400

/** 안전점수 → 색. 같은 등급 안에서 점수가 높을수록 색상·명암이 함께 좋아진다. */
export function scoreColor(score: number, grade: RiskLevel): string {
  const { s } = GRADE_HSL[grade];
  const [lo, hi] = GRADE_SCORE_RANGE[grade];
  const [hLo, hHi] = GRADE_HUE_RANGE[grade];
  const t = Math.max(0, Math.min(1, (score - lo) / (hi - lo)));
  const h = Math.round(hLo + t * (hHi - hLo));
  const l = 46 - t * 14; // 46%(구간 하한, 연함) → 32%(상한, 진함)
  return `hsl(${h} ${s}% ${l}%)`;
}

/** 범례용: 한 등급의 연→진 가로 그라데이션 (왼쪽=낮은 점수, 오른쪽=높은 점수) */
export function gradeGradient(grade: RiskLevel): string {
  const [lo, hi] = GRADE_SCORE_RANGE[grade];
  return `linear-gradient(to right, ${scoreColor(lo, grade)}, ${scoreColor(hi, grade)})`;
}
