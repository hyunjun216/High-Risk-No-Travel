"use client";

import { useEffect, useRef, useState } from "react";
import { shareOrCopy } from "@/components/report-share";

/** 리포트 액션 — 인쇄·공유 (인쇄물에는 print:hidden으로 미포함) */
export default function ReportActions() {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function share() {
    const outcome = await shareOrCopy(
      { title: document.title, url: window.location.href },
      {
        share: navigator.share ? (data) => navigator.share(data) : undefined,
        copy: (text) => navigator.clipboard.writeText(text),
      },
    );
    // 공유 시트가 떴다면 그쪽이 이미 피드백을 준다 — 복사로 떨어졌을 때만 알린다
    if (outcome !== "copied") return;
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex gap-2 print:hidden">
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-1.5 rounded-full bg-teal-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700"
      >
        <span aria-hidden="true">🖨️</span> 인쇄
      </button>
      <button
        type="button"
        onClick={share}
        className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-teal-700 ring-1 ring-teal-200 transition-colors hover:bg-teal-50"
      >
        <span aria-hidden="true">📤</span> {copied ? "링크 복사됨!" : "공유"}
      </button>
    </div>
  );
}
