/**
 * 여행 계획 — 담은 관광지 목록의 순수 로직 (localStorage와 분리해 테스트 가능).
 * 훅(useTravelPlan)이 이 함수들로 상태를 조작한다.
 */
import { haversineKm } from "@/lib/reco/distance";
import { isValidISODate } from "@/lib/date";

/** 하루 일정표의 시간 슬롯 — 표시 순서는 PLAN_SLOTS */
export type PlanSlot = "morning" | "lunch" | "afternoon" | "evening" | "lodging";

export const PLAN_SLOTS: readonly PlanSlot[] = [
  "morning",
  "lunch",
  "afternoon",
  "evening",
  "lodging",
];

export const SLOT_META: Record<PlanSlot, { emoji: string; label: string }> = {
  morning: { emoji: "🌅", label: "오전" },
  lunch: { emoji: "🍚", label: "점심" },
  afternoon: { emoji: "🏞️", label: "오후" },
  evening: { emoji: "🌆", label: "저녁" },
  lodging: { emoji: "🛏️", label: "숙소" },
};

export const MEMO_MAX_LEN = 80;

export interface PlanItem {
  contentId: number;
  title: string;
  lat: number;
  lng: number;
  /** 담을 당시 안전점수 (표시용, 없을 수 있음) */
  score?: number;
  /** 몇 일차 일정인지 (1-based). 미지정=1일차 */
  day?: number;
  /** 하루 중 시간 슬롯. 미지정=레거시 (읽기 시 migratePlan이 채움) */
  slot?: PlanSlot;
  /** 스톱별 짧은 메모 (MEMO_MAX_LEN자) */
  memo?: string;
  /** 데이터 출처 — 숙박 데이터셋 출신(상세페이지 없음). slot과 별개 */
  kind?: "lodging";
}

export interface TravelPlan {
  items: PlanItem[];
  /** 여행 시작일 (YYYY-MM-DD) */
  from?: string;
  /** 여행 종료일 (YYYY-MM-DD) — startDate + nights 파생, 저장은 안 함 */
  to?: string;
  /** 박수 (0=당일, 1=1박2일 …). 총 일수 = nights + 1 */
  nights?: number;
  /** 현재 편집 중인 일차 (카드 담기가 이 일차로 들어감) */
  activeDay?: number;
}

export const EMPTY_PLAN: TravelPlan = { items: [] };

/** 드래그 전송 키 — PlannerCard(드래그 소스)와 TravelPlannerPanel 드롭존이 공유 */
export const PLAN_DRAG_TYPE = "application/x-hari-place";

/** 드래그 페이로드 — 드롭 시 기본 슬롯 계산용 contentTypeId 동봉 */
export type PlanDragPayload = PlanItem & { contentTypeId?: number };

/** 총 여행 일수 (당일=1, 1박2일=2 …) */
export function totalDays(plan: TravelPlan): number {
  return (plan.nights ?? 0) + 1;
}

/** dayN(1-based)의 날짜 YYYY-MM-DD — 시작일 없으면 undefined */
export function dateOfDay(plan: TravelPlan, day: number): string | undefined {
  if (!plan.from) return undefined;
  const base = Date.parse(`${plan.from}T00:00:00Z`);
  return new Date(base + (day - 1) * 86_400_000).toISOString().slice(0, 10);
}

/** 일차별로 그룹핑 (1..totalDays). 각 일차의 항목 배열 */
export function itemsByDay(plan: TravelPlan): PlanItem[][] {
  const days = totalDays(plan);
  const groups: PlanItem[][] = Array.from({ length: days }, () => []);
  for (const it of plan.items) {
    const d = Math.min(Math.max(it.day ?? 1, 1), days);
    groups[d - 1].push(it);
  }
  return groups;
}

/** 레거시 항목의 일차 내 순서 → 슬롯 배정 (기존 코스 담기가 오전→점심→오후 순이라 정합) */
const LEGACY_SLOT_BY_INDEX: readonly PlanSlot[] = ["morning", "lunch", "afternoon"];

/**
 * slot 없는 레거시 항목에 일차 내 순서 기반으로 슬롯을 배정.
 * 전 항목에 slot이 있으면 같은 참조 반환 (useSyncExternalStore getSnapshot 안정성).
 */
export function migratePlan(plan: TravelPlan): TravelPlan {
  if (plan.items.every((it) => it.slot !== undefined)) return plan;
  const dayCount = new Map<number, number>();
  const items = plan.items.map((it) => {
    const day = it.day ?? 1;
    const idx = dayCount.get(day) ?? 0;
    dayCount.set(day, idx + 1);
    if (it.slot !== undefined) return it;
    return { ...it, slot: LEGACY_SLOT_BY_INDEX[idx] ?? "evening" };
  });
  return { ...plan, items };
}

/** 한 일차의 항목을 슬롯별로 그룹핑 — 슬롯 내 순서는 배열 순서. slot 없으면 오전 취급 */
export function itemsBySlot(dayItems: PlanItem[]): Record<PlanSlot, PlanItem[]> {
  const groups: Record<PlanSlot, PlanItem[]> = {
    morning: [],
    lunch: [],
    afternoon: [],
    evening: [],
    lodging: [],
  };
  for (const it of dayItems) groups[it.slot ?? "morning"].push(it);
  return groups;
}

/** 한 일차의 항목을 시간 슬롯 순서로 평탄화 — 거리 체인·지도·리포트 공용 */
export function slotOrderedItems(dayItems: PlanItem[]): PlanItem[] {
  const groups = itemsBySlot(dayItems);
  return PLAN_SLOTS.flatMap((slot) => groups[slot]);
}

/** 특정 항목의 슬롯 변경 */
export function setItemSlot(
  plan: TravelPlan,
  contentId: number,
  slot: PlanSlot,
): TravelPlan {
  return {
    ...plan,
    items: plan.items.map((it) => (it.contentId === contentId ? { ...it, slot } : it)),
  };
}

/** 특정 항목의 메모 설정 — MEMO_MAX_LEN 클램프, 공백뿐이면 제거 */
export function setItemMemo(
  plan: TravelPlan,
  contentId: number,
  memo: string,
): TravelPlan {
  const trimmed = memo.trim().slice(0, MEMO_MAX_LEN);
  return {
    ...plan,
    items: plan.items.map((it) =>
      it.contentId === contentId
        ? { ...it, memo: trimmed === "" ? undefined : trimmed }
        : it,
    ),
  };
}

/** 새로 담는 장소의 기본 슬롯 — 음식점(39)은 점심(찼으면 저녁), 그 외 오전(찼으면 오후) */
export function defaultSlotFor(
  contentTypeId: number | undefined,
  dayItems: PlanItem[],
): PlanSlot {
  const slots = itemsBySlot(dayItems);
  if (contentTypeId === 39) return slots.lunch.length === 0 ? "lunch" : "evening";
  return slots.morning.length === 0 ? "morning" : "afternoon";
}

/** 박수·시작일 설정 (기간 밖 일차의 항목·활성 일차는 마지막 일차로 당김) */
export function setTrip(plan: TravelPlan, nights: number, from?: string): TravelPlan {
  const days = nights + 1;
  const items = plan.items.map((it) =>
    (it.day ?? 1) > days ? { ...it, day: days } : it,
  );
  const activeDay =
    plan.activeDay !== undefined ? Math.min(plan.activeDay, days) : undefined;
  return { ...plan, nights, from, items, activeDay };
}

/** 중복(contentId) 없이 특정 일차(기본 1)에 추가 */
export function addItem(plan: TravelPlan, item: PlanItem, day = 1): TravelPlan {
  if (plan.items.some((p) => p.contentId === item.contentId)) return plan;
  return { ...plan, items: [...plan.items, { ...item, day: item.day ?? day }] };
}

/** 여러 항목을 순서대로 특정 일차(기본 1)에 추가 — 중복 contentId는 addItem 규칙대로 스킵 */
export function addItems(plan: TravelPlan, items: PlanItem[], day = 1): TravelPlan {
  return items.reduce((acc, item) => addItem(acc, item, day), plan);
}

export function removeItem(plan: TravelPlan, contentId: number): TravelPlan {
  return { ...plan, items: plan.items.filter((p) => p.contentId !== contentId) };
}

/** from 위치의 항목을 to 위치로 이동 (드래그 순서 변경) */
export function reorder(plan: TravelPlan, from: number, to: number): TravelPlan {
  const n = plan.items.length;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return plan;
  const items = [...plan.items];
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);
  return { ...plan, items };
}

/** 현재 편집 중인 일차 설정 */
export function setActiveDay(plan: TravelPlan, day: number): TravelPlan {
  return { ...plan, activeDay: day };
}

/** 특정 항목을 같은 자리(순서·일차·슬롯 유지)에서 다른 관광지로 교체 — 진단의 대체 교체(⇄)용.
 *  memo는 옛 장소에 대한 것이므로 버린다.
 *  대상이 없거나 새 항목이 이미 담겨 있으면 no-op (중복 방지 — addItem과 같은 규칙) */
export function swapItem(
  plan: TravelPlan,
  contentId: number,
  next: Omit<PlanItem, "day">,
): TravelPlan {
  if (plan.items.some((p) => p.contentId === next.contentId)) return plan;
  if (!plan.items.some((p) => p.contentId === contentId)) return plan;
  return {
    ...plan,
    items: plan.items.map((it) =>
      it.contentId === contentId
        ? { ...next, memo: undefined, day: it.day, slot: it.slot }
        : it,
    ),
  };
}

/** 특정 항목을 다른 일차로 이동 */
export function setItemDay(plan: TravelPlan, contentId: number, day: number): TravelPlan {
  return {
    ...plan,
    items: plan.items.map((it) => (it.contentId === contentId ? { ...it, day } : it)),
  };
}

/** 항목 배열을 순서대로 이어붙인 직선 총 거리(km, 소수1) — 일차별 호출 */
export function totalDistanceKm(items: PlanItem[]): number {
  let sum = 0;
  for (let i = 1; i < items.length; i++) {
    sum += haversineKm(items[i - 1].lat, items[i - 1].lng, items[i].lat, items[i].lng);
  }
  return Math.round(sum * 10) / 10;
}

/** 순서 제안 노출 기준 — 이 절약(km·비율)에 못 미치면 제안하지 않는다 */
const ORDER_MIN_SAVED_KM = 1;
const ORDER_MIN_SAVED_RATIO = 0.1;

/**
 * 일차 방문 순서 제안 — 첫 스톱 고정, 최근접 이웃 휴리스틱.
 * 현재 순서 대비 절약이 미미하면(1km·10% 미만) null (제안 안 함).
 */
export function suggestDayOrder(
  items: PlanItem[],
): { items: PlanItem[]; savedKm: number } | null {
  if (items.length < 3) return null;
  const current = totalDistanceKm(items);
  const rest = items.slice(1);
  const ordered = [items[0]];
  let cur = items[0];
  while (rest.length > 0) {
    let best = 0;
    let bestKm = Infinity;
    rest.forEach((it, i) => {
      const km = haversineKm(cur.lat, cur.lng, it.lat, it.lng);
      if (km < bestKm) {
        bestKm = km;
        best = i;
      }
    });
    cur = rest.splice(best, 1)[0];
    ordered.push(cur);
  }
  const savedKm = Math.round((current - totalDistanceKm(ordered)) * 10) / 10;
  if (savedKm < ORDER_MIN_SAVED_KM || savedKm < current * ORDER_MIN_SAVED_RATIO) {
    return null;
  }
  return { items: ordered, savedKm };
}

/**
 * 특정 일차의 항목 순서를 통째로 교체 — suggestDayOrder 적용용.
 * ordered가 그 일차 항목의 순열이 아니면 no-op (안전 규칙).
 */
export function reorderDay(
  plan: TravelPlan,
  day: number,
  ordered: PlanItem[],
): TravelPlan {
  const groups = itemsByDay(plan);
  const idx = day - 1;
  if (idx < 0 || idx >= groups.length) return plan;
  const ids = new Set(groups[idx].map((i) => i.contentId));
  if (
    ordered.length !== groups[idx].length ||
    !ordered.every((i) => ids.has(i.contentId))
  ) {
    return plan;
  }
  groups[idx] = ordered;
  return { ...plan, items: groups.flat() };
}

/** undefined 허용 + 1 이상 정수 — 일차·박수류 필드 공용 검사 */
function isOptionalIntAtLeast(v: unknown, min: number): boolean {
  return v === undefined || (typeof v === "number" && Number.isInteger(v) && v >= min);
}

/** 저장/복원 시 형태 검증 — 손상된 localStorage 값 방어 */
export function isValidPlan(v: unknown): v is TravelPlan {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  if (!Array.isArray(p.items)) return false;
  // nights 음수·NaN·소수가 통과하면 totalDays≤0 → itemsByDay의 groups[-1].push 크래시
  if (!isOptionalIntAtLeast(p.nights, 0)) return false;
  // from이 날짜가 아니면 dateOfDay의 toISOString()이 RangeError → 플래너 렌더 크래시
  if (
    p.from !== undefined &&
    (typeof p.from !== "string" || !isValidISODate(p.from))
  ) {
    return false;
  }
  if (!isOptionalIntAtLeast(p.activeDay, 1)) return false;
  return p.items.every(
    (it) =>
      typeof it === "object" &&
      it !== null &&
      typeof (it as PlanItem).contentId === "number" &&
      typeof (it as PlanItem).title === "string" &&
      typeof (it as PlanItem).lat === "number" &&
      typeof (it as PlanItem).lng === "number" &&
      isOptionalIntAtLeast((it as PlanItem).day, 1) &&
      ((it as PlanItem).slot === undefined ||
        PLAN_SLOTS.includes((it as PlanItem).slot as PlanSlot)) &&
      ((it as PlanItem).memo === undefined ||
        typeof (it as PlanItem).memo === "string") &&
      ((it as PlanItem).kind === undefined || (it as PlanItem).kind === "lodging"),
  );
}
