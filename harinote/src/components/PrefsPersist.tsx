"use client";

import { useEffect } from "react";
import type { Profile } from "@/lib/safety/types";
import type { Transport } from "@/lib/prefs";

const YEAR = 60 * 60 * 24 * 365;

/**
 * 값이 있으면 저장, null이면 삭제, undefined면 손대지 않는다.
 *
 * "삭제"와 "관심 없음"을 구분하는 게 핵심이다 — 둘을 뭉치면, 날짜를 다루지 않는 화면에
 * 잠깐 들르는 것만으로 사용자가 고른 날짜가 지워진다.
 */
function remember(name: string, value: string | null | undefined) {
  if (value === undefined) return;
  document.cookie = value
    ? `${name}=${value}; path=/; max-age=${YEAR}; samesite=lax`
    : `${name}=; path=/; max-age=0; samesite=lax`;
}

/**
 * 현재 화면의 조건을 쿠키로 기억 — 다음 화면·다음 방문의 기본값.
 *
 * 날짜는 URL이 날짜를 명시한 화면만 넘긴다(= 사용자가 고른 경우). 고른 결과가 오늘이면
 * null로 넘어와 기억이 지워지고, 날짜와 무관한 진입에서는 undefined로 넘어와 손대지 않는다.
 * 되돌릴 수 없는 기억도, 모르는 사이 지워지는 기억도 만들지 않는 게 이 컴포넌트의 계약이다.
 */
export default function PrefsPersist({
  profile,
  transport,
  date,
  end,
}: {
  profile: Profile;
  transport: Transport;
  /** 문자열=저장, null=삭제, undefined=손대지 않음 */
  date?: string | null;
  end?: string | null;
}) {
  useEffect(() => {
    remember("hari_profile", profile);
    remember("hari_transport", transport);
    remember("hari_date", date);
    remember("hari_end", end);
  }, [profile, transport, date, end]);
  return null;
}
