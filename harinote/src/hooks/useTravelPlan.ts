"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  addItem,
  addItems,
  EMPTY_PLAN,
  isValidPlan,
  itemsByDay,
  type PlanItem,
  removeItem,
  reorder,
  setActiveDay as setActiveDayFn,
  setItemDay,
  setTrip,
  totalDays,
  type TravelPlan,
} from "@/lib/travel-plan";

const STORAGE_KEY = "hari_travel_plan";
/** 같은 탭 내 여러 인스턴스(패널·카드·서랍) 동기화용 이벤트 */
const SYNC_EVENT = "hari-plan-change";

// useSyncExternalStore는 getSnapshot이 안정된 참조를 반환해야 한다 —
// 원문(raw)이 바뀌지 않으면 같은 객체를 돌려주도록 모듈 레벨 캐시.
let cachedRaw: string | null = null;
let cachedPlan: TravelPlan = EMPTY_PLAN;

function readPlan(): TravelPlan {
  // 쿠키/사이트 데이터 차단 시 localStorage "접근" 자체가 SecurityError를 던진다.
  // getSnapshot으로 매 렌더 호출되므로 여기서 던지면 페이지 전체가 크래시 — 빈 계획 유지.
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return cachedPlan;
  }
  if (raw === cachedRaw) return cachedPlan;
  cachedRaw = raw;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    cachedPlan = isValidPlan(parsed) ? parsed : EMPTY_PLAN;
  } catch {
    cachedPlan = EMPTY_PLAN;
  }
  return cachedPlan;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(SYNC_EVENT, onChange);
  window.addEventListener("storage", onChange); // 다른 탭
  return () => {
    window.removeEventListener(SYNC_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function write(next: TravelPlan): boolean {
  const raw = JSON.stringify(next);
  // 모듈 캐시를 즉시 갱신 — 연속 호출(코스 일괄 담기 등)에서 readPlan이 항상 최신 반환
  const prevRaw = cachedRaw;
  const prevPlan = cachedPlan;
  cachedRaw = raw;
  cachedPlan = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, raw);
    window.dispatchEvent(new Event(SYNC_EVENT));
    return true;
  } catch {
    // 저장 실패(쿼터·차단) — 캐시를 원복해 "화면은 새 값, 저장소는 옛 값" 불일치 방지
    cachedRaw = prevRaw;
    cachedPlan = prevPlan;
    return false;
  }
}

/**
 * 여행 계획 상태 — localStorage 외부 스토어를 useSyncExternalStore로 구독.
 * SSR·다른 탭·같은 탭 인스턴스 간 동기화가 자동으로 안전.
 */
export function useTravelPlan() {
  const plan = useSyncExternalStore(subscribe, readPlan, () => EMPTY_PLAN);
  // 서버 렌더는 false, 클라이언트 hydrate 후 true (깜빡임 방지용 게이트)
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const add = useCallback((item: PlanItem, day = 1) => write(addItem(readPlan(), item, day)), []);
  const addMany = useCallback((items: PlanItem[], day = 1) => write(addItems(readPlan(), items, day)), []);
  const replace = useCallback((next: TravelPlan) => write(next), []);
  const remove = useCallback((contentId: number) => write(removeItem(readPlan(), contentId)), []);
  const move = useCallback((from: number, to: number) => write(reorder(readPlan(), from, to)), []);
  const moveToDay = useCallback((contentId: number, day: number) => write(setItemDay(readPlan(), contentId, day)), []);
  const setActiveDay = useCallback((day: number) => write(setActiveDayFn(readPlan(), day)), []);
  const setTripInfo = useCallback((nights: number, from?: string) => write(setTrip(readPlan(), nights, from)), []);
  const clear = useCallback(() => write(EMPTY_PLAN), []);
  const has = useCallback(
    (contentId: number) => plan.items.some((p) => p.contentId === contentId),
    [plan],
  );

  return {
    plan,
    hydrated,
    add,
    addMany,
    replace,
    remove,
    move,
    moveToDay,
    setActiveDay,
    setTrip: setTripInfo,
    clear,
    has,
    count: plan.items.length,
    days: totalDays(plan),
    // 기존 localStorage에 범위 밖 activeDay가 남아 있어도 마지막 일차로 보정
    activeDay: Math.min(plan.activeDay ?? 1, totalDays(plan)),
    byDay: itemsByDay(plan),
  };
}
