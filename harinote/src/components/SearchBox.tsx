import type { Profile } from "@/lib/safety/types";

interface Props {
  defaultQuery?: string;
  /** 현재 프로필 — hidden으로 검색 결과에 유지 */
  profile?: Profile;
  /** 현재 여행 날짜(YYYY-MM-DD) — hidden으로 검색 결과에 유지 */
  date?: string;
  /** 기간 종료 날짜 — hidden으로 검색 결과에 유지 */
  end?: string;
  /** 시군 필터(콤마 구분 코드) — hidden으로 검색 결과에 유지 */
  sigungu?: string;
  compact?: boolean;
}

/** GET 폼 검색창 — JS 없이 /places?q=&profile=&date=&end= 로 이동 */
export default function SearchBox({
  defaultQuery = "",
  profile = "default",
  date,
  end,
  sigungu,
  compact = false,
}: Props) {
  return (
    <form action="/places" method="get" className="w-full">
      <div
        className={`flex items-center gap-2 rounded-2xl bg-white ring-1 ring-slate-200 transition-shadow focus-within:ring-2 focus-within:ring-teal-500 ${
          compact ? "p-1.5 shadow-sm" : "p-2 shadow-lg shadow-teal-900/5"
        }`}
      >
        <span className="pl-3 text-slate-400" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            className={compact ? "h-4 w-4" : "h-5 w-5"}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
        </span>
        <input
          type="search"
          name="q"
          defaultValue={defaultQuery}
          placeholder="관광지 이름이나 지역을 검색하세요 (예: 남이섬)"
          aria-label="관광지 검색"
          className={`min-w-0 flex-1 bg-transparent text-slate-900 placeholder:text-slate-400 focus:outline-none ${
            compact ? "py-1.5 text-sm" : "py-2.5 text-base sm:text-lg"
          }`}
        />
        {profile !== "default" && (
          <input type="hidden" name="profile" value={profile} />
        )}
        {date && <input type="hidden" name="date" value={date} />}
        {end && <input type="hidden" name="end" value={end} />}
        {sigungu && <input type="hidden" name="sigungu" value={sigungu} />}
        <button
          type="submit"
          className={`shrink-0 rounded-xl bg-teal-600 font-bold text-white transition-colors hover:bg-teal-700 ${
            compact ? "px-4 py-1.5 text-sm" : "px-5 py-2.5 text-base"
          }`}
        >
          검색
        </button>
      </div>
    </form>
  );
}
