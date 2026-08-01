"use client";

import { useRouter } from "next/navigation";
import { stepperView } from "@/components/date-stepper";
import { buildQuery } from "@/components/search-params";

interface Props {
  /** URL 확정 날짜 (undefined = 오늘) */
  current?: string;
  /** 서버에서 계산해 내려받는 KST 오늘 — 클라이언트 재계산 금지 (하이드레이션 안전) */
  todayISO: string;
  /** 이동 상한 (오늘+3일) — 단기예보가 제공되는 마지막 날 */
  maxISO: string;
  /** URL에 함께 유지할 파라미터 (profile 등) */
  extraParams?: Record<string, string | number | undefined>;
}

/**
 * 안전지도 날짜 스테퍼 — [−하루] [날짜] [+하루]. 오늘~D+3만 이동 가능.
 *
 * 오늘을 골라도 ?date를 실어 보낸다. parseDate가 오늘을 거부하므로 결과는 그대로 오늘 모드지만,
 * URL에 date가 있다는 사실이 "사용자가 날짜를 골랐다"는 신호가 되어 기억(hari_date) 갱신과
 * 구분된다 — 생략하면 탭으로 홈에 들르기만 해도 고른 날짜가 지워진다.
 */
export default function DateStepper({
  current,
  todayISO,
  maxISO,
  extraParams,
}: Props) {
  const router = useRouter();
  const { selected, prev, next } = stepperView(current, todayISO, maxISO);

  function navigate(iso: string) {
    const q = buildQuery({ ...extraParams, date: iso });
    router.replace(`/${q}`, { scroll: false });
  }

  const stepButton =
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-lg font-bold text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-teal-50 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-slate-600";

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => prev && navigate(prev)}
          disabled={!prev}
          aria-label="하루 전"
          className={stepButton}
        >
          −
        </button>
        <input
          type="date"
          value={selected}
          min={todayISO}
          max={maxISO}
          onChange={(e) => {
            const v = e.target.value;
            // min/max는 브라우저 피커 제한일 뿐이라 범위 밖·빈값은 무시
            if (v && v >= todayISO && v <= maxISO) navigate(v);
          }}
          aria-label="안전지수 조회 날짜"
          className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <button
          type="button"
          onClick={() => next && navigate(next)}
          disabled={!next}
          aria-label="하루 뒤"
          className={stepButton}
        >
          +
        </button>
      </div>
      <p className="mt-1.5 text-xs text-slate-400">
        단기예보가 제공되는 오늘~3일 뒤까지 볼 수 있어요
      </p>
    </div>
  );
}
