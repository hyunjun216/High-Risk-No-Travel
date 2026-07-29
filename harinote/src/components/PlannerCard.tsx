"use client";

import { useTravelPlan } from "@/hooks/useTravelPlan";
import {
  defaultSlotFor,
  PLAN_DRAG_TYPE,
  type PlanDragPayload,
} from "@/lib/travel-plan";

/**
 * 목록 전용 카드 래퍼 — 서버가 렌더한 카드(children)를 감싸 드래그 소스 +
 * "계획 담기" 버튼 부여. 데스크톱은 우측 계획 패널로 드래그, 모바일은 버튼으로 담는다.
 * PlaceCard를 직접 import하지 않는 children 합성 — 서버 전용 데이터
 * (overviews.json 301KB 등)가 클라이언트 번들로 끌려오지 않게 한다.
 */
export default function PlannerCard({
  item,
  children,
}: {
  item: PlanDragPayload;
  children: React.ReactNode;
}) {
  const { add, remove, has, hydrated, activeDay, byDay } = useTravelPlan();
  const added = hydrated && has(item.contentId);
  const addWithSlot = () => {
    const { contentTypeId, ...planItem } = item;
    const slot = defaultSlotFor(contentTypeId, byDay[activeDay - 1] ?? []);
    add({ ...planItem, slot }, activeDay);
  };

  return (
    <div
      className="group/planner relative"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(PLAN_DRAG_TYPE, JSON.stringify(item));
        e.dataTransfer.setData("text/plain", item.title);
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      {children}

      {/* 담기/담김 토글 — 카드 우하단 오버레이 (Link 밖이라 클릭 전파 없음) */}
      <button
        type="button"
        onClick={() => (added ? remove(item.contentId) : addWithSlot())}
        aria-pressed={added}
        title={added ? "계획에서 빼기" : "여행 계획에 담기"}
        className={`absolute bottom-3 right-3 z-10 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold shadow-md transition-colors ${
          added
            ? "bg-teal-600 text-white hover:bg-teal-700"
            : "bg-white text-teal-700 ring-1 ring-teal-200 hover:bg-teal-50"
        }`}
      >
        {added ? "✓ 담김" : "+ 계획"}
      </button>

      {/* 데스크톱 드래그 힌트 (호버 시) */}
      <span className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full bg-slate-900/70 px-2 py-0.5 text-[10px] font-semibold text-white opacity-0 transition-opacity group-hover/planner:opacity-100 lg:block">
        ⠿ 드래그해서 담기
      </span>
    </div>
  );
}
