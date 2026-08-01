"use client";

import { usePathname } from "next/navigation";
import { isOwnSearchRoute } from "./nav-active";

/**
 * 헤더 전역 검색 자리 — /places에서만 비운다.
 *
 * layout은 searchParams를 읽을 수 없어 여기 검색창은 여행 조건(날짜·시군·유형·반려동물)을
 * hidden으로 실을 방법이 없다. 그래서 /places처럼 조건이 걸린 화면에서 이 폼으로 검색하면
 * 조건이 조용히 초기화된다. /places는 조건을 전부 아는 자체 검색창을 화면 안에 두므로
 * 헤더 것을 감춰 "조건을 잃는 경로"를 없앤다.
 *
 * SearchBox는 서버 컴포넌트라 children으로 받는다 (클라이언트 경계를 넘기지 않는다).
 */
export default function HeaderSearch({
  children,
}: {
  children: React.ReactNode;
}) {
  if (isOwnSearchRoute(usePathname())) return null;
  return (
    <div className="hidden max-w-xs flex-1 items-center self-center md:flex">
      {children}
    </div>
  );
}
