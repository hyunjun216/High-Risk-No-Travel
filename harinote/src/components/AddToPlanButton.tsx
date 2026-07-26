"use client";

import { useTravelPlan } from "@/hooks/useTravelPlan";
import type { PlanItem } from "@/lib/travel-plan";

/**
 * 상세 페이지 "+ 계획" 버튼 — 목록으로 돌아가지 않고 상세에서 바로 담는다.
 * 카드(PlannerCard)와 같은 토글 규칙: 이미 담겨 있으면 빼기.
 */
export default function AddToPlanButton({ item }: { item: PlanItem }) {
  const { add, remove, has, hydrated, activeDay } = useTravelPlan();
  const added = hydrated && has(item.contentId);

  return (
    <button
      type="button"
      onClick={() => (added ? remove(item.contentId) : add(item, activeDay))}
      aria-pressed={added}
      title={added ? "계획에서 빼기" : "여행 계획에 담기"}
      className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
        added
          ? "bg-teal-600 text-white hover:bg-teal-700"
          : "bg-white text-teal-700 ring-1 ring-teal-200 hover:bg-teal-50"
      }`}
    >
      {added ? "✓ 계획에 담김" : "＋ 여행 계획에 담기"}
    </button>
  );
}
