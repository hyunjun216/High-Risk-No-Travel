import { describe, expect, it } from "vitest";
import {
  isValidSavedPlanList,
  MAX_SAVED_PLANS,
  removeSavedPlan,
  evictedBySaving,
  savedEntryFor,
  upsertSavedPlan,
  type SavedPlan,
} from "@/lib/saved-plans";
import type { TravelPlan } from "@/lib/travel-plan";

function entry(id: string, name = id): SavedPlan {
  return {
    id,
    name,
    savedAt: "2026-07-18T00:00:00.000Z",
    plan: { items: [{ contentId: 1, title: "A", lat: 37.75, lng: 128.87 }] },
  };
}

describe("upsertSavedPlan", () => {
  it("신규는 맨 앞에 추가하고 원본을 변경하지 않는다", () => {
    const list = [entry("a")];
    const next = upsertSavedPlan(list, entry("b"));
    expect(next.map((p) => p.id)).toEqual(["b", "a"]);
    expect(list).toHaveLength(1);
  });

  it("같은 id는 교체하고 맨 앞으로 이동", () => {
    const list = [entry("a"), entry("b")];
    const next = upsertSavedPlan(list, entry("b", "새 이름"));
    expect(next.map((p) => p.id)).toEqual(["b", "a"]);
    expect(next[0].name).toBe("새 이름");
  });

  it("MAX 초과 시 오래된 쪽(뒤)이 밀려난다", () => {
    let list: SavedPlan[] = [];
    for (let i = 0; i < MAX_SAVED_PLANS + 3; i++) {
      list = upsertSavedPlan(list, entry(`p${i}`));
    }
    expect(list).toHaveLength(MAX_SAVED_PLANS);
    expect(list[0].id).toBe(`p${MAX_SAVED_PLANS + 2}`);
    expect(list.some((p) => p.id === "p0")).toBe(false);
  });
});

describe("removeSavedPlan", () => {
  it("해당 항목만 제거", () => {
    const next = removeSavedPlan([entry("a"), entry("b")], "a");
    expect(next.map((p) => p.id)).toEqual(["b"]);
  });
});

describe("isValidSavedPlanList", () => {
  it("정상 구조 통과", () => {
    expect(isValidSavedPlanList([entry("a")])).toBe(true);
    expect(isValidSavedPlanList([])).toBe(true);
  });
  it("손상 값 거부 (배열 아님·필드 누락·plan 손상)", () => {
    expect(isValidSavedPlanList(null)).toBe(false);
    expect(isValidSavedPlanList({})).toBe(false);
    expect(isValidSavedPlanList([{ id: "a" }])).toBe(false);
    expect(
      isValidSavedPlanList([{ ...entry("a"), plan: { items: "nope" } }]),
    ).toBe(false);
  });
});

// "불러와서 수정 → 저장"이 갱신이 아니라 복제가 되면, 목록이 거의 같은 카드로 차고
// 20개 상한에서 관계없는 오래된 계획이 조용히 사라진다.
describe("savedEntryFor — 편집한 계획은 갱신, 새 계획만 추가", () => {
  const BASE: TravelPlan = {
    items: [{ contentId: 1, title: "A", lat: 37.75, lng: 128.87 }],
  };
  const stamp = "2026-08-01T00:00:00.000Z";
  const fixedId = () => "NEW";

  it("savedId가 있으면 그 id를 이어받는다", () => {
    const e = savedEntryFor({ ...BASE, savedId: "origin" }, "설악산 여행", stamp, fixedId);
    expect(e.id).toBe("origin");
  });

  it("savedId가 없으면 새 id를 발급한다", () => {
    expect(savedEntryFor(BASE, "새 계획", stamp, fixedId).id).toBe("NEW");
  });

  it("불러온 계획을 고쳐 저장해도 목록이 늘지 않는다 (복제 방지)", () => {
    const list = [
      { id: "origin", name: "설악산 여행", savedAt: stamp, plan: BASE },
      { id: "other", name: "제주 여행", savedAt: stamp, plan: BASE },
    ];
    const edited: TravelPlan = { ...BASE, savedId: "origin", nights: 2 };
    const next = upsertSavedPlan(list, savedEntryFor(edited, "설악산 여행", stamp, fixedId));

    expect(next).toHaveLength(2);
    expect(next.filter((p) => p.name === "설악산 여행")).toHaveLength(1);
    expect(next.find((p) => p.id === "origin")?.plan.nights).toBe(2);
    expect(next.some((p) => p.id === "other")).toBe(true);
  });

  it("20개가 찬 뒤 반복 저장해도 다른 계획이 밀려나지 않는다", () => {
    const full: SavedPlan[] = Array.from({ length: MAX_SAVED_PLANS }, (_, i) => ({
      id: `p${i}`,
      name: `계획 ${i}`,
      savedAt: stamp,
      plan: BASE,
    }));
    let list = full;
    for (let n = 1; n <= 5; n++) {
      list = upsertSavedPlan(
        list,
        savedEntryFor({ ...BASE, savedId: "p0", nights: n }, "계획 0", stamp, fixedId),
      );
    }
    expect(list).toHaveLength(MAX_SAVED_PLANS);
    // 상한 끝에 있던 계획이 살아있어야 한다 (조용한 FIFO 삭제 방지)
    expect(list.some((p) => p.id === `p${MAX_SAVED_PLANS - 1}`)).toBe(true);
  });
});

describe("evictedBySaving", () => {
  const full: SavedPlan[] = Array.from({ length: MAX_SAVED_PLANS }, (_, i) =>
    entry(`p${i}`, `계획 ${i}`),
  );
  const BASE: TravelPlan = {
    items: [{ contentId: 1, title: "A", lat: 37.75, lng: 128.87 }],
  };

  it("여유가 있으면 밀려나는 계획이 없다", () => {
    expect(evictedBySaving(full.slice(0, MAX_SAVED_PLANS - 1), BASE)).toBeNull();
  });

  it("가득 찬 상태에서 새 계획을 저장하면 가장 오래된 것이 밀려난다", () => {
    expect(evictedBySaving(full, BASE)?.id).toBe(`p${MAX_SAVED_PLANS - 1}`);
  });

  it("가득 차도 기존 계획 갱신이면 아무도 밀려나지 않는다", () => {
    expect(evictedBySaving(full, { ...BASE, savedId: "p3" })).toBeNull();
  });

  it("savedId가 보관함에 없으면(삭제된 계획) 새 계획으로 본다", () => {
    expect(evictedBySaving(full, { ...BASE, savedId: "없는id" })?.id).toBe(
      `p${MAX_SAVED_PLANS - 1}`,
    );
  });
});
