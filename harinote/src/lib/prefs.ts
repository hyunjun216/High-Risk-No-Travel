/**
 * 사용자 조건 기억 — 쿠키 기반 (서버 전용 읽기).
 * 첫 화면에서 고른 동행/이동수단을 저장해 다음 방문의 기본값으로 쓴다.
 * URL 파라미터가 있으면 항상 그것이 우선 (쿠키는 폴백).
 */
import { cookies } from "next/headers";
import { PROFILE_LABEL, type Profile } from "@/lib/safety/types";

export type Transport = "transit" | "car";

export const PREF_COOKIE = {
  profile: "hari_profile",
  transport: "hari_transport",
  date: "hari_date",
  end: "hari_end",
} as const;

export async function savedProfile(): Promise<Profile | undefined> {
  const v = (await cookies()).get(PREF_COOKIE.profile)?.value;
  return v && v in PROFILE_LABEL ? (v as Profile) : undefined;
}

export async function savedTransport(): Promise<Transport | undefined> {
  const v = (await cookies()).get(PREF_COOKIE.transport)?.value;
  return v === "car" || v === "transit" ? v : undefined;
}

/**
 * 기억된 여행 날짜·기간 — 검증하지 않고 원문 그대로 돌려준다.
 * 호출부가 URL 파라미터와 같은 자리에 넣어 parseDate(Range)를 태우므로,
 * 유효범위(D+1~D+366) 판정이 한 곳에만 있고 지난 날짜 쿠키는 거기서 자동으로 탈락한다.
 *
 * 날짜를 "고르는" 화면(홈)은 이 값을 읽지 않는다 — 스테퍼가 오늘을 고르면 ?date가
 * 빠지는 규약(DateStepper)이라, 홈까지 폴백을 걸면 오늘로 되돌아갈 수 없다.
 * 쿠키는 고른 날짜를 다른 화면으로 "실어 나르는" 용도다.
 */
export async function savedDate(): Promise<string | undefined> {
  return (await cookies()).get(PREF_COOKIE.date)?.value;
}

export async function savedEnd(): Promise<string | undefined> {
  return (await cookies()).get(PREF_COOKIE.end)?.value;
}
