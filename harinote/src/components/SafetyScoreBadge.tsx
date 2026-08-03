import type { RiskLevel } from "@/lib/safety/types";
import { GRADE_LABEL } from "@/lib/safety/types";

/** 등급 색 팔레트 — 배지 밖에서 같은 색으로 카드를 짤 때 재사용한다 (상세 점수 요약 등) */
export const GRADE_STYLE: Record<
  RiskLevel,
  { pill: string; dot: string; text: string; ring: string }
> = {
  low: {
    pill: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    dot: "bg-emerald-500",
    text: "text-emerald-700",
    ring: "ring-emerald-200",
  },
  moderate: {
    pill: "bg-amber-50 text-amber-800 ring-amber-200",
    dot: "bg-amber-500",
    text: "text-amber-700",
    ring: "ring-amber-200",
  },
  high: {
    pill: "bg-red-50 text-red-800 ring-red-200",
    dot: "bg-red-500",
    text: "text-red-700",
    ring: "ring-red-200",
  },
};

interface Props {
  score: number;
  grade: RiskLevel;
  /** sm: 리스트 카드용 알약형, lg: 상세 페이지용 대형 */
  size?: "sm" | "lg";
  /** lg 전용 캡션 (기본: "오늘의 안전 점수" — 날짜 모드에서 교체) */
  label?: string;
}

export default function SafetyScoreBadge({
  score,
  grade,
  size = "sm",
  label = "오늘의 안전 점수",
}: Props) {
  const s = GRADE_STYLE[grade];

  if (size === "lg") {
    return (
      <div
        className={`flex items-center gap-4 rounded-2xl bg-white p-5 ring-1 ${s.ring}`}
      >
        <div className="flex flex-col items-center">
          <span className={`text-5xl font-extrabold tabular-nums ${s.text}`}>
            {score}
          </span>
          <span className="text-xs font-medium text-slate-400">/ 100점</span>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className={`flex items-center gap-1.5 font-bold ${s.text}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
            {GRADE_LABEL[grade]}
          </p>
        </div>
      </div>
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${s.pill}`}
    >
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      <span className="tabular-nums">{score}점</span>
      <span aria-hidden="true">·</span>
      {GRADE_LABEL[grade]}
    </span>
  );
}
