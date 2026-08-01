"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeTab, type TabKey } from "./nav-active";

const TABS: { key: TabKey; href: string; label: string }[] = [
  { key: "map", href: "/", label: "안전 지도" },
  { key: "places", href: "/places", label: "여행 계획" },
  { key: "plans", href: "/plans", label: "저장한 계획" },
];

/** 헤더 탭 바 — 현재 라우트의 탭에 teal 밑줄 표시 */
export default function NavTabs() {
  const active = activeTab(usePathname());

  return (
    <nav aria-label="주요 메뉴" className="flex h-full items-stretch">
      {TABS.map((tab) => {
        const isActive = active === tab.key;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={`relative flex items-center px-3 text-sm font-semibold transition-colors sm:px-4 ${
              isActive ? "text-teal-700" : "text-slate-500 hover:text-teal-700"
            }`}
          >
            {tab.label}
            <span
              aria-hidden="true"
              className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full ${
                isActive ? "bg-teal-600" : "bg-transparent"
              }`}
            />
          </Link>
        );
      })}
    </nav>
  );
}
