import Link from "next/link";
import type { Profile } from "@/lib/safety/types";
import { buildQuery } from "@/components/search-params";
import LinkLabel from "@/components/LinkLabel";

interface Props {
  /** 프로필 쿼리를 바꿔 이동할 기준 경로 (예: /places/126273) */
  basePath: string;
  current: Profile;
  /** profile 외에 유지할 쿼리 파라미터 */
  extraParams?: Record<string, string | number | undefined>;
}

/** 현재 프로필에 아이/부모님이 포함되는지 */
export function has(current: Profile, who: "kids" | "seniors"): boolean {
  if (who === "kids") return current === "with_kids" || current === "with_kids_seniors";
  return current === "with_seniors" || current === "with_kids_seniors";
}

/** 아이/부모님 토글 결과 → 새 Profile 값 */
export function toggled(current: Profile, who: "kids" | "seniors"): Profile {
  const kids = has(current, "kids") !== (who === "kids");
  const seniors = has(current, "seniors") !== (who === "seniors");
  if (kids && seniors) return "with_kids_seniors";
  if (kids) return "with_kids";
  if (seniors) return "with_seniors";
  return "default";
}

/**
 * 동행 프로필 칩 — 아이·부모님을 각각 독립 토글 (동시 선택 가능).
 * 이동수단(자차/대중교통)은 점수 축이 아니라 추천 반경 조건이라 여기 없음.
 */
export default function ProfileChips({ basePath, current, extraParams = {} }: Props) {
  const chips: { who: "kids" | "seniors"; icon: string; label: string }[] = [
    { who: "kids", icon: "🧒", label: "아이 동반" },
    { who: "seniors", icon: "👵", label: "부모님 동반" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => {
        const active = has(current, c.who);
        const href = `${basePath}${buildQuery({ ...extraParams, profile: toggled(current, c.who) })}`;
        return (
          <Link
            key={c.who}
            href={href}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
              active
                ? "bg-teal-600 text-white shadow-sm"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-teal-50 hover:text-teal-700"
            }`}
          >
            <LinkLabel>
              <span aria-hidden="true">{c.icon}</span>
              {c.label}
            </LinkLabel>
          </Link>
        );
      })}
    </div>
  );
}
