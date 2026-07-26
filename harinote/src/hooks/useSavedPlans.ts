"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  isValidSavedPlanList,
  removeSavedPlan,
  upsertSavedPlan,
  type SavedPlan,
} from "@/lib/saved-plans";
import type { TravelPlan } from "@/lib/travel-plan";

const STORAGE_KEY = "hari_saved_plans";
/** 같은 탭 내 여러 인스턴스(패널 저장 버튼·목록 페이지) 동기화용 이벤트 */
const SYNC_EVENT = "hari-saved-plans-change";

const EMPTY_LIST: SavedPlan[] = [];

// useTravelPlan과 같은 패턴 — getSnapshot 안정 참조를 위한 모듈 레벨 캐시
let cachedRaw: string | null = null;
let cachedList: SavedPlan[] = EMPTY_LIST;

function readList(): SavedPlan[] {
  // useTravelPlan.readPlan과 동일 — 접근 차단 SecurityError가 렌더를 죽이지 않게
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return cachedList;
  }
  if (raw === cachedRaw) return cachedList;
  cachedRaw = raw;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    cachedList = isValidSavedPlanList(parsed) ? parsed : EMPTY_LIST;
  } catch {
    cachedList = EMPTY_LIST;
  }
  return cachedList;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(SYNC_EVENT, onChange);
  window.addEventListener("storage", onChange); // 다른 탭
  return () => {
    window.removeEventListener(SYNC_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function write(next: SavedPlan[]): boolean {
  const raw = JSON.stringify(next);
  const prevRaw = cachedRaw;
  const prevList = cachedList;
  cachedRaw = raw;
  cachedList = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, raw);
    window.dispatchEvent(new Event(SYNC_EVENT));
    return true;
  } catch {
    // 실패 시 캐시 원복 + false — 호출부가 "저장했어요" 거짓 표시를 막을 수 있게
    cachedRaw = prevRaw;
    cachedList = prevList;
    return false;
  }
}

function newId(): string {
  // crypto.randomUUID는 secure context(localhost/https) 전제 — 아니면 폴백
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 저장된 여행 계획 목록 — localStorage 외부 스토어를 useSyncExternalStore로 구독.
 * useTravelPlan(활성 계획)과 같은 구조, 키만 다르다.
 */
export function useSavedPlans() {
  const list = useSyncExternalStore(subscribe, readList, () => EMPTY_LIST);
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const save = useCallback((name: string, plan: TravelPlan): boolean => {
    return write(
      upsertSavedPlan(readList(), {
        id: newId(),
        name,
        savedAt: new Date().toISOString(),
        plan,
      }),
    );
  }, []);
  const remove = useCallback(
    (id: string) => write(removeSavedPlan(readList(), id)),
    [],
  );

  return { list, hydrated, save, remove, count: list.length };
}
