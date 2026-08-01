import Link from "next/link";
import { buildQuery, sortParam } from "@/components/search-params";
import { availableSortKeys, SORT_LABEL, type SortKey } from "@/lib/places-sort";

interface Props {
  sort: SortKey;
  /** 검색어가 있을 때만 정확도순 노출 — 없으면 안전점수순과 동일해 무의미 */
  hasQuery: boolean;
  /** 페이지 공통 링크 파라미터 — page가 없으므로 정렬 변경 시 자동 1페이지 리셋 */
  currentParams: Record<string, string | number | undefined>;
}

/**
 * 정렬 드롭다운 — TravelFilterPanel과 같은 <details> 무JS 패턴.
 * 옵션 클릭 → URL 이동 → 서버 리렌더로 자연히 닫힌다.
 */
export default function SortDropdown({ sort, hasQuery, currentParams }: Props) {
  // 노출 규칙은 places-sort.ts — 결과가 안전점수순과 같아지는 옵션은 감춘다
  const options = availableSortKeys(hasQuery);
  // URL로 감춰진 값(?sort=popularity)이 들어와도 실제 목록 순서는 안전점수순이므로
  // 라벨은 노출 옵션 안에서만 고른다 — 표시와 실제가 어긋나지 않게.
  const current = options.includes(sort) ? sort : options[0];

  // 고를 게 하나뿐이면 열어도 선택지가 없다 — 현재 정렬 기준만 표시한다
  if (options.length < 2) {
    return (
      <span className="shrink-0 rounded-full bg-slate-50 px-3.5 py-1.5 text-sm font-semibold text-slate-500">
        {SORT_LABEL[current]}
      </span>
    );
  }

  return (
    <details className="relative shrink-0">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full bg-white px-3.5 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-100 [&::-webkit-details-marker]:hidden">
        {SORT_LABEL[current]}
        <span aria-hidden="true">▾</span>
      </summary>
      <div className="absolute right-0 z-10 mt-1.5 w-36 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-slate-200">
        {options.map((key) => {
          const active = key === current;
          return (
            <Link
              key={key}
              // 기본값은 맥락에 따라 다르다 — 검색 중에는 안전점수순을 URL에 명시해야
              // 기본값(정확도순)으로 되돌아가지 않는다 (search-params.ts)
              href={`/places${buildQuery({ ...currentParams, sort: sortParam(key, hasQuery) })}`}
              aria-current={active ? "true" : undefined}
              className={`block rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                active
                  ? "bg-teal-50 text-teal-700"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {SORT_LABEL[key]}
            </Link>
          );
        })}
      </div>
    </details>
  );
}
