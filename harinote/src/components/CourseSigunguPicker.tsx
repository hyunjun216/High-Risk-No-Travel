"use client";

/**
 * 코스 추천 모달 공용 시군 선택기 (단일 선택 — 코스는 한 시군을 앵커로 생성).
 * 검색 필터(여행 조건 패널)에서 시군을 2곳 이상 골랐다면 그 시군들을
 * "내 여행 지역" 그룹으로 먼저 보여줘 페이지 선택이 헛돌지 않게 한다.
 */
import { SIGUNGU_SEATS } from "@/lib/risk/regions";

interface Props {
  selected?: number;
  /** 검색 필터에서 고른 시군 (오름차순) — 2곳 이상이면 그룹 분리 */
  mine: number[];
  onSelect: (code: number) => void;
}

export default function CourseSigunguPicker({
  selected,
  mine,
  onSelect,
}: Props) {
  const entries = Object.entries(SIGUNGU_SEATS).map(([code, s]) => ({
    code: Number(code),
    name: s.name,
  }));
  const mineSet = new Set(mine);
  const grouped = mine.length >= 2;

  const chip = (e: { code: number; name: string }) => {
    const active = selected === e.code;
    return (
      <button
        key={e.code}
        type="button"
        aria-pressed={active}
        onClick={() => onSelect(e.code)}
        className={`rounded-lg px-2 py-1.5 text-center text-xs font-bold transition-colors ${
          active
            ? "bg-teal-600 text-white shadow-sm"
            : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-teal-50 hover:text-teal-700"
        }`}
      >
        {e.name}
      </button>
    );
  };

  if (!grouped) {
    return (
      <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {entries.map(chip)}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <div>
        <p className="text-[11px] font-bold text-slate-400">📍 내 여행 지역</p>
        <div className="mt-1 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {entries.filter((e) => mineSet.has(e.code)).map(chip)}
        </div>
      </div>
      <div>
        <p className="text-[11px] font-bold text-slate-400">다른 지역</p>
        <div className="mt-1 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {entries.filter((e) => !mineSet.has(e.code)).map(chip)}
        </div>
      </div>
    </div>
  );
}
