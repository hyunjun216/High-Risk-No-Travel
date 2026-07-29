"use client";

/**
 * 저장된 여행 계획 목록 — 카드로 보여주고 "불러와서 수정"(활성 계획 교체 후
 * /places 이동)과 삭제를 제공한다. 데이터는 localStorage(useSavedPlans).
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CourseRouteMap from "@/components/CourseRouteMap";
import { useSavedPlans } from "@/hooks/useSavedPlans";
import { useTravelPlan } from "@/hooks/useTravelPlan";
import { itemsByDay, slotOrderedItems, totalDays } from "@/lib/travel-plan";
import { encodePlanQuery } from "@/lib/plan/report-params";
import { formatKoreanDate, todayISOSeoul } from "@/lib/date";
import type { SavedPlan } from "@/lib/saved-plans";

export default function SavedPlansList() {
  const { list, hydrated, remove } = useSavedPlans();
  const { plan, replace } = useTravelPlan();
  const router = useRouter();

  const loadPlan = (saved: SavedPlan) => {
    if (
      plan.items.length > 0 &&
      !window.confirm("지금 작업 중인 계획을 덮어씁니다. 계속할까요?")
    ) {
      return;
    }
    replace(saved.plan);
    router.push("/places");
  };

  if (!hydrated) {
    return (
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100" />
        ))}
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 px-6 py-16 text-center">
        <p className="text-4xl" aria-hidden="true">
          🧳
        </p>
        <p className="mt-3 font-bold text-slate-700">저장된 여행이 없어요</p>
        <p className="mt-1 text-sm text-slate-500">
          관광지를 담아 계획을 만들고, 플래너의 저장 버튼으로 보관해 보세요.
        </p>
        <Link
          href="/places"
          className="mt-4 rounded-full bg-teal-600 px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-teal-700"
        >
          관광지 보러 가기 →
        </Link>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {list.map((saved) => {
        const days = totalDays(saved.plan);
        const byDay = itemsByDay(saved.plan);
        return (
          <li
            key={saved.id}
            className="rounded-2xl bg-white p-4 ring-1 ring-slate-200"
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-bold text-slate-900">
                  {saved.name}
                </h2>
                <p className="mt-0.5 text-xs font-semibold text-slate-500">
                  {saved.plan.items.length}곳 · {days === 1 ? "당일치기" : `${days - 1}박 ${days}일`}
                  {saved.plan.from && ` · ${formatKoreanDate(saved.plan.from)} 출발`}
                </p>
                {/* savedAt은 UTC ISO — KST 날짜로 변환해야 자정~09시 저장분이 안 밀린다.
                    손상된 값이면 날짜 포맷터가 RangeError로 던지므로 줄 자체를 숨긴다 */}
                {!Number.isNaN(Date.parse(saved.savedAt)) && (
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {formatKoreanDate(todayISOSeoul(new Date(saved.savedAt)))} 저장
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/plans/report?${encodePlanQuery(saved.plan, saved.name)}`}
                  className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-teal-700 ring-1 ring-teal-200 transition-colors hover:bg-teal-50"
                >
                  계획 리포트
                </Link>
                <button
                  type="button"
                  onClick={() => loadPlan(saved)}
                  className="rounded-full bg-teal-600 px-4 py-1.5 text-xs font-bold text-white transition-colors hover:bg-teal-700"
                >
                  불러와서 수정
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`'${saved.name}' 계획을 삭제할까요?`)) {
                      remove(saved.id);
                    }
                  }}
                  aria-label={`${saved.name} 삭제`}
                  className="rounded-full px-3 py-1.5 text-xs font-semibold text-slate-400 ring-1 ring-slate-200 transition-colors hover:bg-red-50 hover:text-red-500"
                >
                  삭제
                </button>
              </div>
            </div>

            {/* 일차별 스톱 체인 — 시간 슬롯 순 (제목은 저장 스냅샷에 있음) */}
            <div className="mt-3 space-y-1 border-t border-slate-100 pt-3">
              {byDay.map((dayItems, i) =>
                dayItems.length === 0 ? null : (
                  <p key={i} className="text-xs leading-relaxed text-slate-600">
                    {days > 1 && (
                      <span className="mr-1 font-bold text-slate-400">
                        {i + 1}일차
                      </span>
                    )}
                    {slotOrderedItems(dayItems).map((it, j) => (
                      <span key={it.contentId}>
                        {j > 0 && <span className="text-slate-300"> → </span>}
                        {it.kind === "lodging" ? (
                          // 숙박 데이터셋 출신 — 상세 페이지가 없어 링크 대신 텍스트
                          <span className="font-semibold">🛏️ {it.title}</span>
                        ) : (
                          <Link
                            href={`/places/${it.contentId}`}
                            className="font-semibold hover:text-teal-700 hover:underline"
                          >
                            {it.title}
                          </Link>
                        )}
                      </span>
                    ))}
                  </p>
                ),
              )}
            </div>

            {/* 루트 지도 — 펼칠 때만 마운트 (Leaflet 다중 인스턴스 비용 절약) */}
            {saved.plan.items.length >= 2 && <RouteMapToggle saved={saved} />}
          </li>
        );
      })}
    </ul>
  );
}

/** 카드 하단 루트 지도 토글 — 열 때만 CourseRouteMap을 마운트한다 */
function RouteMapToggle({ saved }: { saved: SavedPlan }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-semibold text-slate-400 transition-colors hover:text-teal-600"
      >
        🗺 루트 지도 {open ? "접기" : "보기"}
      </button>
      {open && (
        <div className="mt-2">
          <CourseRouteMap
            stops={itemsByDay(saved.plan)
              .flatMap((dayItems) => slotOrderedItems(dayItems))
              .map((it) => ({
                title: it.title,
                lat: it.lat,
                lng: it.lng,
              }))}
          />
        </div>
      )}
    </div>
  );
}
