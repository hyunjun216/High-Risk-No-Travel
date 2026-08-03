/**
 * 저장된 여행 계획 목록 — 순수 로직 (localStorage와 분리해 테스트 가능).
 * 훅(useSavedPlans)이 이 함수들로 상태를 조작한다.
 */
import { isValidPlan, type TravelPlan } from "@/lib/travel-plan";

export interface SavedPlan {
  id: string;
  name: string;
  /** 저장 시각 (ISO) */
  savedAt: string;
  /** 저장 당시 활성 계획 스냅샷 */
  plan: TravelPlan;
}

/** localStorage 용량 방어 상한 — 초과 시 오래된 것부터 밀려난다 */
export const MAX_SAVED_PLANS = 20;

/** 같은 id는 교체, 신규는 맨 앞에 — MAX 초과분은 뒤(오래된 쪽)를 잘라낸다 */
export function upsertSavedPlan(
  list: SavedPlan[],
  entry: SavedPlan,
): SavedPlan[] {
  const rest = list.filter((p) => p.id !== entry.id);
  return [entry, ...rest].slice(0, MAX_SAVED_PLANS);
}

/**
 * 저장할 항목 만들기 — "불러와서 수정"으로 연 계획(plan.savedId)은 그 id를 이어받아
 * upsertSavedPlan이 교체하게 하고, 새 계획만 새 id를 받는다.
 *
 * 늘 새 id를 발급하면 편집·저장을 반복할 때마다 거의 같은 카드가 쌓이고,
 * MAX_SAVED_PLANS(20)에 닿는 순간 관계없는 오래된 계획이 아무 안내 없이 사라진다.
 */
export function savedEntryFor(
  plan: TravelPlan,
  name: string,
  savedAt: string,
  newId: () => string,
): SavedPlan {
  return { id: plan.savedId ?? newId(), name, savedAt, plan };
}

/**
 * 이 계획을 저장하면 밀려날 계획 — 없으면 null.
 *
 * 상한에 닿았을 때 오래된 계획이 아무 안내 없이 사라지던 것을 UI가 미리 알리기 위한
 * 값이다. 기존 계획 갱신(savedId가 보관함에 있음)은 자리를 새로 쓰지 않으므로 제외.
 */
export function evictedBySaving(
  list: SavedPlan[],
  plan: TravelPlan,
): SavedPlan | null {
  if (list.length < MAX_SAVED_PLANS) return null;
  if (plan.savedId && list.some((p) => p.id === plan.savedId)) return null;
  return list[list.length - 1] ?? null;
}

export function removeSavedPlan(list: SavedPlan[], id: string): SavedPlan[] {
  return list.filter((p) => p.id !== id);
}

/** 저장/복원 시 형태 검증 — 손상된 localStorage 값 방어 */
export function isValidSavedPlanList(v: unknown): v is SavedPlan[] {
  if (!Array.isArray(v)) return false;
  return v.every(
    (p) =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as SavedPlan).id === "string" &&
      typeof (p as SavedPlan).name === "string" &&
      typeof (p as SavedPlan).savedAt === "string" &&
      isValidPlan((p as SavedPlan).plan),
  );
}
