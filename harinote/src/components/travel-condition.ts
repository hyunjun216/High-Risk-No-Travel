/**
 * 코스 추천 모달의 "여행 조건" 요약 문구 — 검색 필터(여행 조건 패널)에서
 * 상속된 동행·이동수단을 표시용 파트로 만든다. 동행은 비기본만,
 * 이동수단은 코스 반경에 항상 영향을 주므로 상시 포함.
 * (pet은 코스 엔진에 반영되지 않으므로 표시하지 않는다 — 오해 방지)
 */
import type { Profile } from "@/lib/safety/types";
import type { Transport } from "@/lib/prefs";
import { has } from "@/components/ProfileChips";

export function courseConditionParts(
  profile: Profile,
  transport: Transport,
): string[] {
  const parts: string[] = [];
  if (has(profile, "kids")) parts.push("🧒 아이 동반");
  if (has(profile, "seniors")) parts.push("👵 부모님 동반");
  parts.push(transport === "car" ? "🚗 자차" : "🚌 대중교통");
  return parts;
}
