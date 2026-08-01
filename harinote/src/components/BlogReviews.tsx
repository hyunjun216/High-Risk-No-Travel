/**
 * 네이버 블로그 후기 섹션 — 서버가 넘긴 BlogReview[]를 카드 리스트로 표시.
 * 후기가 없으면(키 없음·검색 0건) 호출부에서 섹션 자체를 렌더하지 않는다.
 * 각 카드는 원문 블로그로 새 탭 이동 (본문 전재 없이 제목·요약·링크만).
 */
import type { BlogReview } from "@/lib/review/naver-blog";

interface Props {
  reviews: BlogReview[];
}

export default function BlogReviews({ reviews }: Props) {
  return (
    <ul className="mt-3 grid gap-3 sm:grid-cols-2">
      {/* li의 min-w-0: 없으면 아래 truncate(nowrap)가 셀의 min-content를 키워 카드가 넘친다 */}
      {reviews.map((r) => (
        <li key={r.link} className="min-w-0">
          <a
            href={r.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-full flex-col rounded-2xl bg-white p-4 ring-1 ring-slate-200 transition-shadow hover:shadow-md hover:ring-teal-300"
          >
            <p className="line-clamp-2 font-bold text-slate-900">{r.title}</p>
            {r.summary && (
              <p className="mt-1.5 line-clamp-3 flex-1 text-sm leading-relaxed text-slate-500">
                {r.summary}
              </p>
            )}
            <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-400">
              <span className="rounded-full bg-green-50 px-2 py-0.5 text-green-700">
                blog
              </span>
              <span className="truncate">{r.blogger}</span>
              {r.postDate && (
                <span className="ml-auto shrink-0 tabular-nums">
                  {r.postDate}
                </span>
              )}
            </p>
          </a>
        </li>
      ))}
    </ul>
  );
}
