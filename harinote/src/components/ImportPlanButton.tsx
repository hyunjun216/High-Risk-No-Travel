"use client";

import { useRouter } from "next/navigation";
import { useTravelPlan } from "@/hooks/useTravelPlan";
import type { PlanItem, TravelPlan } from "@/lib/travel-plan";

/** 플래너 여행 일수 select(TravelPlannerPanel NIGHTS_OPTIONS)의 최대 박수 */
const MAX_NIGHTS = 3;

/**
 * 계획 리포트의 "내 플래너에 담기" — 공유받은 리포트 URL이 곧 계획 가져오기 경로가 된다.
 * 현재 작업 중인 계획이 있으면 덮어쓰기 확인 후 교체하고 검색 화면으로 이동한다.
 */
export default function ImportPlanButton({
  items,
  nights,
  from,
}: {
  items: PlanItem[];
  nights: number;
  from?: string;
}) {
  const { plan, replace } = useTravelPlan();
  const router = useRouter();

  const importPlan = () => {
    if (
      plan.items.length > 0 &&
      !window.confirm("지금 작업 중인 계획을 이 계획으로 덮어씁니다. 계속할까요?")
    ) {
      return;
    }
    // URL 파서(MAX_DAY=14)가 플래너 여행 일수 select 최대(3박)보다 큰 값을 허용하므로
    // 클램프 — 초과 일차 항목은 itemsByDay가 마지막 일차로 당긴다
    const next: TravelPlan = {
      items,
      nights: Math.min(nights, MAX_NIGHTS),
      from,
      activeDay: 1,
    };
    replace(next);
    router.push("/places");
  };

  return (
    <button
      type="button"
      onClick={importPlan}
      className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-teal-700 ring-1 ring-teal-200 transition-colors hover:bg-teal-50"
    >
      <span aria-hidden="true">🧳</span> 내 플래너에 담기
    </button>
  );
}
