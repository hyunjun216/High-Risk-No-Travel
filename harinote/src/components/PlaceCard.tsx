import Link from "next/link";
import Image from "next/image";
import type { PlaceWithSafety } from "@/lib/datasource";
import type { PlaceEnvType } from "@/lib/tour/types";
import { ENV_TYPE_LABEL, placeTypeLabel } from "@/lib/tour/types";
import type { Profile } from "@/lib/safety/types";
import SafetyScoreBadge from "@/components/SafetyScoreBadge";
import { buildQuery, profileParam } from "@/components/search-params";
import { cardSummary } from "@/lib/tour/overviews";
import { isPetFriendly } from "@/lib/tour/pet-friendly";
import { isKidsFriendly } from "@/lib/tour/kids-friendly";

/** imageUrl 없는 관광지의 플레이스홀더 — 환경 유형별 이모지·그라데이션 */
const ENV_PLACEHOLDER: Record<PlaceEnvType, { emoji: string; bg: string }> = {
  indoor: { emoji: "🏛️", bg: "from-violet-100 to-indigo-200" },
  outdoor_water: { emoji: "🏞️", bg: "from-teal-100 to-cyan-200" },
  outdoor_mountain: { emoji: "⛰️", bg: "from-emerald-100 to-green-200" },
  outdoor_coast: { emoji: "🌊", bg: "from-sky-100 to-blue-200" },
  outdoor_general: { emoji: "🌳", bg: "from-lime-100 to-emerald-200" },
};

interface Props {
  place: PlaceWithSafety;
  profile: Profile;
  /** 선택된 여행 날짜 (YYYY-MM-DD) — 링크에 유지 */
  date?: string;
  /** 기간 종료 날짜 — 링크에 유지 */
  end?: string;
  /** 카드 하단 추가 정보 (예: 대체지 추천의 거리·점수 비교) */
  footer?: React.ReactNode;
}

export default function PlaceCard({ place, profile, date, end, footer }: Props) {
  const ph = ENV_PLACEHOLDER[place.envType];
  const href = `/places/${place.contentId}${buildQuery({ profile: profileParam(profile), date, end })}`;

  return (
    <Link
      href={href}
      className="group overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 transition-shadow hover:shadow-lg hover:ring-teal-300"
    >
      <div className="relative h-40 overflow-hidden">
        {place.imageUrl ? (
          <Image
            src={place.imageUrl}
            alt={place.title}
            fill
            sizes="(max-width: 640px) 100vw, 320px"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${ph.bg}`}
          >
            <span className="text-5xl" aria-hidden="true">
              {ph.emoji}
            </span>
          </div>
        )}
        {/* 점수 배지 — 이미지 좌상단에 크게 (목록에서 가장 중요한 정보) */}
        <div className="absolute left-3 top-3">
          <SafetyScoreBadge score={place.safety.score} grade={place.safety.grade} />
        </div>
        {/* 분류·동반 배지 — 우상단으로 이동 (점수와 분리) */}
        <div className="absolute right-3 top-3 flex flex-wrap justify-end gap-1.5">
          <span className="rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-sm">
            {placeTypeLabel(place)}
          </span>
          <span className="rounded-full bg-slate-900/70 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm">
            {ENV_TYPE_LABEL[place.envType]}
          </span>
          {isPetFriendly(place.contentId) && (
            <span className="rounded-full bg-amber-100/95 px-2 py-0.5 text-[11px] font-semibold text-amber-800 shadow-sm">
              🐶 동반
            </span>
          )}
          {isKidsFriendly(place.contentId) && (
            <span className="rounded-full bg-pink-100/95 px-2 py-0.5 text-[11px] font-semibold text-pink-800 shadow-sm">
              👶 유아
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2 p-4">
        <h3 className="truncate text-base font-bold text-slate-900 group-hover:text-teal-700">
          {place.title}
        </h3>
        <p className="truncate text-sm text-slate-500">{place.addr}</p>
        {(() => {
          const summary = cardSummary(place.contentId);
          return summary ? (
            <p className="line-clamp-2 text-xs leading-relaxed text-slate-500">
              {summary}
            </p>
          ) : null;
        })()}
        {footer}
      </div>
    </Link>
  );
}
