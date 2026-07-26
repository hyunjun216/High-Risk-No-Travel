"use client";

import { useState } from "react";
import TravelPlannerPanel from "@/components/TravelPlannerPanel";
import { useTravelPlan } from "@/hooks/useTravelPlan";
import type { Profile } from "@/lib/safety/types";
import type { Transport } from "@/lib/prefs";

/**
 * 모바일 전용 계획 서랍 — 하단 고정 "내 계획(N)" 버튼 + bottom sheet.
 * 데스크톱(lg+)에서는 우측 패널을 쓰므로 숨긴다.
 */
interface Props {
  /** 목록의 선택 날짜(?date=) — 서랍 속 코스 추천도 같은 날짜 점수로 */
  courseDate?: string;
  /** 안전 진단용 현재 조건 (패널로 전달) */
  profile?: Profile;
  transport?: Transport;
}

export default function PlannerDrawer({ courseDate, profile, transport }: Props) {
  const { count, hydrated } = useTravelPlan();
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden">
      {/* 하단 고정 버튼 */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-teal-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-teal-900/20 transition-transform active:scale-95"
      >
        🗺 내 계획{hydrated && count > 0 ? ` (${count})` : ""}
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end">
          {/* 배경 */}
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          {/* 시트 */}
          <div className="relative max-h-[85vh] overflow-y-auto rounded-t-3xl bg-slate-50 p-3 pb-8">
            <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-slate-300" />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-4 top-4 text-sm font-semibold text-slate-400"
            >
              닫기 ✕
            </button>
            <TravelPlannerPanel compact courseDate={courseDate} profile={profile} transport={transport} />
          </div>
        </div>
      )}
    </div>
  );
}
