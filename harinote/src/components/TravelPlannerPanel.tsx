"use client";

import { useState } from "react";
import Link from "next/link";
import CourseRouteMap from "@/components/CourseRouteMap";
import CourseRecommendModal from "@/components/CourseRecommendModal";
import { useTravelPlan } from "@/hooks/useTravelPlan";
import { useSavedPlans } from "@/hooks/useSavedPlans";
import { PLAN_DRAG_TYPE } from "@/components/PlannerCard";
import {
  dateOfDay,
  swapItem,
  totalDistanceKm,
  type PlanItem,
  type TravelPlan,
} from "@/lib/travel-plan";
import { formatKoreanDate, todayISOSeoul } from "@/lib/date";
import { diagnosePlan } from "@/lib/plan/diagnose-action";
import { encodePlanQuery } from "@/lib/plan/report-params";
import {
  planSignature,
  STOP_MODE_LABEL,
  type PlanDiagnosisDto,
  type StopAlternativeDto,
} from "@/lib/plan/diagnose";
import type { Profile } from "@/lib/safety/types";
import type { Transport } from "@/lib/prefs";

const NIGHTS_OPTIONS = [
  { nights: 0, label: "당일치기" },
  { nights: 1, label: "1박 2일" },
  { nights: 2, label: "2박 3일" },
  { nights: 3, label: "3박 4일" },
];

/**
 * 내 여행 계획 패널 — 카드 드롭으로 담고, 일차별 탭으로 나눠 순서 정렬,
 * 일차마다 직선 루트+총거리. N박이면 1일차/2일차 탭. localStorage 영속.
 */
interface Props {
  compact?: boolean;
  /** 목록의 선택 날짜(?date=) — 코스 추천도 같은 날짜 점수로 (한 화면 두 점수 방지) */
  courseDate?: string;
  /** 안전 진단에 쓰는 동행 프로필·이동수단 — 목록 화면의 현재 조건과 동일하게 */
  profile?: Profile;
  transport?: Transport;
}

export default function TravelPlannerPanel({
  compact = false,
  courseDate,
  profile = "default",
  transport = "transit",
}: Props) {
  const { plan, hydrated, add, has, remove, move, moveToDay, replace, setActiveDay, setTrip, clear, count, days, activeDay, byDay } =
    useTravelPlan();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropActive, setDropActive] = useState(false);

  // 계획 저장 — 인라인 이름 입력 → useSavedPlans에 스냅샷 기록
  const { save } = useSavedPlans();
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [savedFlash, setSavedFlash] = useState<"ok" | "fail" | null>(null);
  const defaultName = plan.from ? `${formatKoreanDate(plan.from)} 여행` : "내 여행 계획";
  const confirmSave = () => {
    if (plan.items.length === 0) return; // 비운 직후 잔류 폼에서 빈 계획 저장 방지
    // 저장 실패(쿼터·차단)를 성공으로 표시하지 않는다 — 무통보 데이터 손실 방지
    const ok = save(saveName.trim() || defaultName, plan);
    setSaving(false);
    setSavedFlash(ok ? "ok" : "fail");
    setTimeout(() => setSavedFlash(null), 2000);
  };

  // 계획 안전 진단 — 스톱별 일차 날짜 재채점 + 주의 스톱 교체 후보
  const [diag, setDiag] = useState<PlanDiagnosisDto | null>(null);
  const [diagSig, setDiagSig] = useState("");
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagError, setDiagError] = useState(false);

  async function runDiagnosis(target?: TravelPlan) {
    const p = target ?? plan;
    if (p.items.length === 0 || diagLoading) return;
    setDiagLoading(true);
    setDiagError(false);
    try {
      const result = await diagnosePlan({
        items: p.items.map((it) => ({ contentId: it.contentId, day: it.day ?? 1 })),
        from: p.from,
        profile,
        transport,
      });
      setDiag(result);
      setDiagSig(planSignature(p, profile, transport));
    } catch {
      setDiagError(true);
    } finally {
      setDiagLoading(false);
    }
  }

  // 스톱 구성·출발일·조건이 바뀌면 기존 진단은 낡은 것 (순서 변경은 무관)
  const diagStale =
    diag !== null && planSignature(plan, profile, transport) !== diagSig;
  const diagByStop = new Map(
    !diagStale && diag ? diag.stops.map((s) => [s.contentId, s]) : [],
  );

  // 교체(⇄): 같은 자리에서 바꾸고 새 계획으로 즉시 재진단
  function swapWithAlternative(oldContentId: number, alt: StopAlternativeDto) {
    const next = swapItem(plan, oldContentId, {
      contentId: alt.contentId,
      title: alt.title,
      lat: alt.lat,
      lng: alt.lng,
      score: alt.score,
    });
    if (next === plan) return;
    replace(next);
    void runDiagnosis(next);
  }

  // 카드에서 온 드롭 페이로드 파싱 (없으면 null = 내부 순서변경)
  function parseCardDrop(e: React.DragEvent): PlanItem | null {
    const raw = e.dataTransfer.getData(PLAN_DRAG_TYPE);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PlanItem;
    } catch {
      return null;
    }
  }

  // 드롭존(빈 공간·컨테이너)에 카드가 떨어지면 활성 일차로 추가
  function onZoneDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropActive(false);
    const item = parseCardDrop(e);
    if (item) add(item, activeDay);
  }

  const dayLabel = (d: number) => {
    const iso = dateOfDay(plan, d);
    return iso ? formatKoreanDate(iso) : `${d}일차`;
  };

  const dayItems = hydrated ? (byDay[activeDay - 1] ?? []) : [];

  return (
    <aside
      aria-label="내 여행 계획"
      className={`flex flex-col rounded-2xl bg-white ring-1 ring-slate-200 ${compact ? "" : ""}`}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="text-base font-bold text-slate-900">
          🗺 내 여행 계획
          {hydrated && count > 0 && (
            <span className="ml-1.5 text-sm font-semibold text-teal-600">{count}</span>
          )}
        </h2>
        {hydrated && count > 0 && (
          <div className="flex items-center gap-2.5">
            <Link
              href={`/plans/report?${encodePlanQuery(plan)}${
                profile !== "default" ? `&profile=${profile}` : ""
              }${transport === "car" ? "&tr=car" : ""}`}
              className="text-xs font-semibold text-slate-400 transition-colors hover:text-teal-600"
            >
              리포트
            </Link>
            <button
              type="button"
              onClick={() => {
                setSaveName(defaultName);
                setSaving((v) => !v);
              }}
              className={`text-xs font-semibold transition-colors ${
                savedFlash === "ok"
                  ? "text-teal-600"
                  : savedFlash === "fail"
                    ? "text-red-500"
                    : "text-slate-400 hover:text-teal-600"
              }`}
            >
              {savedFlash === "ok"
                ? "✓ 저장했어요"
                : savedFlash === "fail"
                  ? "저장 못 했어요"
                  : "저장"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSaving(false);
                clear();
              }}
              className="text-xs font-semibold text-slate-400 transition-colors hover:text-red-500"
            >
              비우기
            </button>
          </div>
        )}
      </div>

      {/* 저장 이름 입력 (저장 버튼 토글) — 계획이 비면 함께 사라진다 */}
      {saving && hydrated && count > 0 && (
        <form
          className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            confirmSave();
          }}
        >
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            aria-label="계획 이름"
            maxLength={30}
            autoFocus
            className="min-w-0 flex-1 rounded-lg bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-teal-600 px-2.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-teal-700"
          >
            저장
          </button>
        </form>
      )}

      {/* AI 코스 추천 — 팝업에서 테마·시군·프로필 선택 후 활성 일차에 담기 */}
      <div className="border-b border-slate-100 px-4 py-2.5">
        <CourseRecommendModal date={courseDate} />
      </div>

      {/* 여행 일수·출발일 설정 — localStorage 계획에만 반영 (일차 탭·날짜 라벨) */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <select
          value={hydrated ? (plan.nights ?? 0) : 0}
          onChange={(e) => setTrip(Number(e.target.value), plan.from)}
          aria-label="여행 일수"
          className="rounded-lg bg-white px-2 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          {NIGHTS_OPTIONS.map((o) => (
            <option key={o.nights} value={o.nights}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={hydrated ? (plan.from ?? "") : ""}
          min={todayISOSeoul()}
          onChange={(e) =>
            setTrip(plan.nights ?? 0, e.target.value || undefined)
          }
          aria-label="여행 출발일"
          className="rounded-lg bg-white px-2 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      </div>

      {/* 계획 안전 진단 — 각 스톱을 해당 일차 날짜 기준으로 재채점 */}
      {hydrated && count > 0 && (
        <div className="border-b border-slate-100 px-4 py-2.5">
          <button
            type="button"
            onClick={() => void runDiagnosis()}
            disabled={diagLoading}
            className="w-full rounded-xl bg-white px-3 py-2 text-sm font-bold text-teal-700 ring-1 ring-teal-600/40 transition-colors hover:bg-teal-50 disabled:opacity-60"
          >
            {diagLoading ? "진단 중…" : "🩺 계획 안전 진단"}
          </button>
          {diagError && (
            <p className="mt-1.5 text-xs font-semibold text-red-500">
              진단에 실패했어요. 잠시 후 다시 시도해 주세요.
            </p>
          )}
          {diag && diagStale && !diagLoading && (
            <p className="mt-1.5 text-xs font-semibold text-amber-600">
              계획이 바뀌었어요 — 다시 진단해 보세요
            </p>
          )}
          {diag && !diagStale && !diagError && (
            <p
              className={`mt-1.5 text-xs font-semibold ${
                diag.riskyCount > 0 ? "text-amber-700" : "text-teal-700"
              }`}
            >
              {diag.riskyCount > 0
                ? `⚠️ 주의 스톱 ${diag.riskyCount}곳 — 교체 후보를 확인해 보세요`
                : "✓ 전 스톱 방문 주의 요인 낮음"}
              {diag.assumedToday && (
                <span className="font-normal text-slate-400">
                  {" "}
                  · 출발일 미설정, 오늘 출발 기준
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {/* 일차 탭 (N박일 때만) */}
      {days > 1 && (
        <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3 py-2">
          {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setActiveDay(d)}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(PLAN_DRAG_TYPE)) e.preventDefault();
              }}
              onDrop={(e) => {
                // 다른 일차 탭 위로 카드를 떨어뜨리면 그 일차로 담김.
                // 이미 담긴 카드면 add가 no-op이라 탭만 바뀌는 착시가 생김 → 일차 이동으로 처리
                const item = parseCardDrop(e);
                if (item) {
                  e.preventDefault();
                  if (has(item.contentId)) moveToDay(item.contentId, d);
                  else add(item, d);
                  setActiveDay(d);
                }
              }}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                activeDay === d
                  ? "bg-teal-600 text-white"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200"
              }`}
            >
              {d}일차
              {byDay[d - 1]?.length ? ` (${byDay[d - 1].length})` : ""}
            </button>
          ))}
        </div>
      )}

      {/* 활성 일차 날짜 */}
      {hydrated && plan.from && (
        <p className="px-4 pt-2 text-xs font-semibold text-sky-700">
          {dayLabel(activeDay)} 기준
        </p>
      )}

      {/* 담긴 관광지 — 드롭존 + 순서 드래그 */}
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(PLAN_DRAG_TYPE)) {
            e.preventDefault();
            setDropActive(true);
          }
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={onZoneDrop}
        className={`mx-3 my-2 min-h-[80px] rounded-xl p-1 transition-colors ${
          dropActive ? "bg-teal-50 ring-2 ring-teal-300" : ""
        }`}
      >
        {!hydrated || dayItems.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-400">
            관광지 카드를 여기로 드래그하거나
            <br />
            <span className="font-semibold text-slate-500">+ 계획</span> 버튼으로 담아보세요
          </p>
        ) : (
          <ol className="space-y-1.5">
            {dayItems.map((it) => {
              const globalIdx = plan.items.indexOf(it);
              const stop = diagByStop.get(it.contentId);
              const risky = stop?.grade !== undefined && stop.grade !== null && stop.grade !== "low";
              return (
                <li
                  key={it.contentId}
                  draggable
                  onDragStart={(e) => {
                    // Firefox는 dragstart에서 데이터가 없으면 드래그를 시작하지 않는다
                    e.dataTransfer.setData("text/plain", it.title);
                    e.dataTransfer.effectAllowed = "move";
                    setDragIndex(globalIdx);
                  }}
                  // 취소(Esc)·바깥 드롭 포함 어떤 종료에서도 잔류 dragIndex 정리 —
                  // 남아 있으면 이후 무관한 드래그가 onDrop에서 순서를 뒤섞는다
                  onDragEnd={() => setDragIndex(null)}
                  onDragOver={(e) => {
                    // 내부 순서변경일 때만 이 항목이 드롭을 받는다
                    if (dragIndex !== null) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    const item = parseCardDrop(e);
                    if (item) {
                      // 외부 카드는 컨테이너가 처리하도록 버블링 (가로채지 않음)
                      return;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    if (dragIndex !== null && dragIndex !== globalIdx) {
                      move(dragIndex, globalIdx);
                    }
                    setDragIndex(null);
                  }}
                  className={`rounded-lg bg-slate-50 px-2.5 py-2 ring-1 ${
                    risky ? "ring-amber-300" : "ring-slate-100"
                  }`}
                >
                  <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-600 text-[11px] font-bold text-white">
                    {dayItems.indexOf(it) + 1}
                  </span>
                  <Link
                    href={`/places/${it.contentId}`}
                    className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700 hover:text-teal-700"
                  >
                    {it.title}
                  </Link>
                  {stop && stop.score !== null ? (
                    // 진단 점수 — 해당 일차 날짜 기준 (담을 당시 점수를 대체)
                    <span
                      title={`${STOP_MODE_LABEL[stop.mode]}${
                        stop.topFactors.length > 0
                          ? ` · ${stop.topFactors.map((f) => `${f.label} −${f.points}점`).join(" · ")}`
                          : ""
                      }`}
                      className={`shrink-0 text-xs font-bold tabular-nums ${
                        stop.grade === "low"
                          ? "text-teal-600"
                          : stop.grade === "moderate"
                            ? "text-amber-600"
                            : "text-red-600"
                      }`}
                    >
                      {risky && "⚠ "}
                      {stop.score}
                    </span>
                  ) : it.score !== undefined ? (
                    <span className="shrink-0 text-xs font-bold tabular-nums text-slate-400">
                      {it.score}
                    </span>
                  ) : null}
                  {/* 다른 일차로 이동 (N박일 때) */}
                  {days > 1 && (
                    <select
                      value={activeDay}
                      onChange={(e) => moveToDay(it.contentId, Number(e.target.value))}
                      aria-label="일차 변경"
                      className="shrink-0 rounded bg-white text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200"
                    >
                      {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>
                          {d}일차
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(it.contentId)}
                    aria-label={`${it.title} 빼기`}
                    className="shrink-0 text-slate-300 transition-colors hover:text-red-500"
                  >
                    ✕
                  </button>
                  </div>
                  {/* 주의 스톱 — 요인 안내 + 같은 자리 교체 후보 */}
                  {stop && risky && (
                    <div className="mt-1.5 space-y-1 pl-7">
                      {stop.topFactors.length > 0 && (
                        <p className="text-[11px] font-semibold text-amber-700">
                          {stop.topFactors
                            .map((f) => `${f.label} −${f.points}점`)
                            .join(" · ")}
                          <span className="font-normal text-slate-400">
                            {" "}
                            · {STOP_MODE_LABEL[stop.mode]}
                          </span>
                        </p>
                      )}
                      {stop.alternatives.map((alt) => (
                        <button
                          key={alt.contentId}
                          type="button"
                          onClick={() => swapWithAlternative(it.contentId, alt)}
                          className="flex w-full items-center gap-1.5 rounded-lg bg-white px-2 py-1.5 text-left text-xs ring-1 ring-slate-200 transition-colors hover:bg-teal-50 hover:ring-teal-300"
                        >
                          <span className="shrink-0 font-bold text-teal-700">⇄</span>
                          <span className="min-w-0 flex-1 truncate font-semibold text-slate-600">
                            {alt.title}
                          </span>
                          <span className="shrink-0 font-bold tabular-nums text-teal-600">
                            {alt.score}
                          </span>
                          <span className="shrink-0 text-slate-400">
                            {alt.distanceKm}km
                          </span>
                        </button>
                      ))}
                      {stop.alternatives.length === 0 && (
                        <p className="text-[11px] text-slate-400">
                          근처에 더 나은 대체지가 없어요
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* 활성 일차 루트 지도 + 총거리 (2곳 이상) */}
      {hydrated && dayItems.length >= 2 && (
        <div className="border-t border-slate-100 p-3">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>{days > 1 ? `${activeDay}일차 ` : ""}이동 경로</span>
            <span className="text-slate-700">직선 {totalDistanceKm(dayItems)}km</span>
          </div>
          <CourseRouteMap
            stops={dayItems.map((it) => ({ title: it.title, lat: it.lat, lng: it.lng }))}
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
            직선 거리 기준이에요. 실제 소요 시간은 지도 앱에서 확인하세요.
          </p>
        </div>
      )}
    </aside>
  );
}
