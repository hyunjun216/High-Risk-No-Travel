"use client";

/**
 * N박 전체 일정 추천 모달 — 플래너 패널에서 열어 시군·테마를 고르면
 * 플래너의 박수·출발일 기준으로 일차별 스톱 + 밤 숙소를 추천하고,
 * "계획에 반영"으로 전 일차를 통째로 채운다 (숙소는 참고 표시만).
 */
import { useState, useTransition } from "react";
import { useTravelPlan } from "@/hooks/useTravelPlan";
import { SIGUNGU_SEATS } from "@/lib/risk/regions";
import { COURSE_THEME_META, type CourseTheme } from "@/lib/course/themed";
import {
  recommendMultiDayCourse,
  type MultiDayCourseDto,
} from "@/lib/course/multi-day-action";
import { formatKoreanDate } from "@/lib/date";
import type { Profile } from "@/lib/safety/types";
import type { PlanItem, TravelPlan } from "@/lib/travel-plan";

const SLOT_EMOJI: Record<string, string> = {
  morning: "🌅",
  lunch: "🍽️",
  afternoon: "☀️",
};

const GRADE_TEXT: Record<string, string> = {
  low: "text-teal-600",
  moderate: "text-amber-600",
  high: "text-red-600",
};

export default function MultiDayCourseModal({ profile }: { profile: Profile }) {
  const { plan, replace, days } = useTravelPlan();
  const [open, setOpen] = useState(false);
  const [sigungu, setSigungu] = useState<number | undefined>();
  const [theme, setTheme] = useState<CourseTheme>("nature");
  const [result, setResult] = useState<MultiDayCourseDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  const load = (code: number, t: CourseTheme) => {
    startTransition(async () => {
      try {
        const data = await recommendMultiDayCourse({
          sigunguCode: code,
          theme: t,
          profile,
          days,
          from: plan.from,
        });
        setResult(data);
        setFailed(data === null);
      } catch {
        setResult(null);
        setFailed(true);
      }
    });
  };

  const pick = (code?: number, t?: CourseTheme) => {
    const nextCode = code ?? sigungu;
    const nextTheme = t ?? theme;
    if (code !== undefined) setSigungu(code);
    if (t !== undefined) setTheme(t);
    if (nextCode !== undefined) load(nextCode, nextTheme);
  };

  const applyToPlan = () => {
    if (!result) return;
    if (
      plan.items.length > 0 &&
      !window.confirm("지금 담긴 계획을 추천 일정으로 덮어씁니다. 계속할까요?")
    ) {
      return;
    }
    // 숙소는 상세 페이지가 없는 별도 데이터라 계획에는 넣지 않는다 (참고 표시 전용)
    const items: PlanItem[] = result.days.flatMap((d) =>
      d.stops.map((s) => ({
        contentId: s.place.contentId,
        title: s.place.title,
        lat: s.place.lat,
        lng: s.place.lng,
        score: s.place.score,
        day: d.day,
      })),
    );
    const next: TravelPlan = {
      items,
      nights: plan.nights,
      from: plan.from,
      activeDay: 1,
    };
    replace(next);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl bg-white px-3 py-2 text-sm font-bold text-teal-700 ring-1 ring-teal-600/40 transition-colors hover:bg-teal-50"
      >
        🧳 {days - 1}박 전체 일정 추천
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/50"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="relative max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">
                🧳 {days - 1}박 {days}일 전체 일정 추천
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm font-semibold text-slate-400 hover:text-slate-600"
              >
                닫기 ✕
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {plan.from
                ? `${formatKoreanDate(plan.from)} 출발 기준 — 일차별 날짜 점수로 추천해요`
                : "출발일 미설정 — 오늘 출발 기준으로 추천해요"}
            </p>

            {/* 테마 */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(Object.keys(COURSE_THEME_META) as CourseTheme[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => pick(undefined, t)}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                    theme === t
                      ? "bg-teal-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {COURSE_THEME_META[t].emoji} {COURSE_THEME_META[t].label}
                </button>
              ))}
            </div>

            {/* 지역 */}
            <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              {Object.entries(SIGUNGU_SEATS).map(([code, seat]) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => pick(Number(code))}
                  className={`rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
                    sigungu === Number(code)
                      ? "bg-teal-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {seat.name}
                </button>
              ))}
            </div>

            {/* 결과 */}
            <div className="mt-4">
              {sigungu === undefined ? (
                <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                  시작 지역을 선택해 주세요 — 1일차는 그 시군에서, 다음 날은
                  숙소 근처에서 이어가요.
                </p>
              ) : isPending ? (
                <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                  일정을 만드는 중…
                </p>
              ) : failed ? (
                <p className="rounded-xl bg-amber-50 px-4 py-6 text-center text-sm font-semibold text-amber-800">
                  이 조건으로는 일정을 만들지 못했어요 — 다른 테마나 지역을
                  선택해 보세요.
                </p>
              ) : result ? (
                <>
                  {result.days.map((day) => (
                    <section key={day.day} className="mt-3 first:mt-0">
                      <h3 className="text-sm font-bold text-slate-800">
                        {day.day}일차{" "}
                        <span className="font-semibold text-slate-400">
                          · {formatKoreanDate(day.dateISO)} · 직선 {day.totalKm}km
                        </span>
                      </h3>
                      <ul className="mt-1.5 space-y-1">
                        {day.stops.map((s) => (
                          <li
                            key={s.place.contentId}
                            className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm ring-1 ring-slate-100"
                          >
                            <span aria-hidden="true">{SLOT_EMOJI[s.slot]}</span>
                            <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">
                              {s.place.title}
                            </span>
                            <span
                              className={`shrink-0 text-xs font-bold tabular-nums ${GRADE_TEXT[s.place.grade]}`}
                            >
                              {s.place.score}
                            </span>
                          </li>
                        ))}
                        {day.lodging && (
                          <li className="flex items-center gap-2 rounded-lg bg-sky-50 px-2.5 py-1.5 text-sm ring-1 ring-sky-100">
                            <span aria-hidden="true">🛏️</span>
                            <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">
                              {day.lodging.place.title}
                            </span>
                            <span className="shrink-0 text-xs text-slate-400">
                              {day.lodging.distanceKm}km
                            </span>
                            <span
                              className={`shrink-0 text-xs font-bold tabular-nums ${GRADE_TEXT[day.lodging.place.grade]}`}
                            >
                              {day.lodging.place.score}
                            </span>
                          </li>
                        )}
                      </ul>
                    </section>
                  ))}
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                    숙소는 TourAPI 숙박 데이터 기반 참고 정보예요 — 예약·요금은
                    별도로 확인하세요. 총 직선 {result.totalKm}km.
                  </p>
                  <button
                    type="button"
                    onClick={applyToPlan}
                    className="mt-3 w-full rounded-xl bg-teal-600 px-3 py-2.5 text-sm font-bold text-white transition-colors hover:bg-teal-700"
                  >
                    이 일정으로 계획 채우기 (숙소 제외)
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
