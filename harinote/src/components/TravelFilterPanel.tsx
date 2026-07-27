import Link from "next/link";
import type { Profile } from "@/lib/safety/types";
import type { Transport } from "@/lib/prefs";
import { SIGUNGU_SEATS } from "@/lib/risk/regions";
import ProfileChips, { has } from "@/components/ProfileChips";
import {
  buildQuery,
  sigunguParam,
  sigunguSummaryLabel,
} from "@/components/search-params";

interface Props {
  /** 선택된 시군 코드 (오름차순 정규형, 빈 배열 = 전체) */
  sigungu: number[];
  profile: Profile;
  pet: boolean;
  transport: Transport;
  /** 페이지 공통 링크 파라미터 — 각 칩은 자기 파라미터만 덮어쓴다 */
  currentParams: Record<string, string | number | undefined>;
  /** 리렌더 후 패널 열림 유지 (?fo=1 — 패널 내부 링크에만 실린다) */
  open: boolean;
}

/** 라벨 열 + 칩 영역 한 줄 — 모바일은 라벨이 위로 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-3">
      <span className="w-14 shrink-0 text-xs font-bold tracking-wide text-slate-400 sm:pt-2">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * 여행 조건 통합 패널 — 여정 내내 고정되는 필터(지역·동행·이동수단)를
 * <details> 하나로 묶는다. 접힌 상태에선 현재 설정 요약 한 줄만 보이고,
 * JS 없이 링크만으로 동작. 패널 내부 링크에 fo=1을 실어 선택 후
 * 리렌더에도 열려 있게 한다 (외부 링크로 이동하면 자연히 접힘).
 */
export default function TravelFilterPanel({
  sigungu,
  profile,
  pet,
  transport,
  currentParams,
  open,
}: Props) {
  const hrefWith = (over: Record<string, string | number | undefined>) =>
    `/places${buildQuery({ ...currentParams, ...over, fo: "1" })}`;

  const toggleSigungu = (code: number) =>
    hrefWith({
      sigungu: sigunguParam(
        sigungu.includes(code)
          ? sigungu.filter((c) => c !== code)
          : [...sigungu, code].sort((a, b) => a - b),
      ),
    });

  // 요약 = 기본값이 아닌 조건만 나열 (대중교통·시군 전체는 기본이라 생략)
  const parts: string[] = [];
  if (sigungu.length > 0) parts.push(sigunguSummaryLabel(sigungu));
  if (has(profile, "kids")) parts.push("🧒 아이 동반");
  if (has(profile, "seniors")) parts.push("👵 부모님 동반");
  if (pet) parts.push("🐶 반려동물");
  if (transport === "car") parts.push("🚗 자차");
  const anyActive = parts.length > 0;

  return (
    <details open={open || undefined}>
      <summary
        className={`inline-flex w-fit cursor-pointer list-none flex-wrap items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors [&::-webkit-details-marker]:hidden ${
          anyActive
            ? "bg-teal-600 text-white shadow-sm"
            : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-teal-50 hover:text-teal-700"
        }`}
      >
        <span aria-hidden="true">⚙️</span>
        {anyActive ? parts.join(" · ") : "여행 조건 설정"}
        <span aria-hidden="true">▾</span>
      </summary>

      <div className="mt-2 space-y-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <Row label="지역">
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {Object.entries(SIGUNGU_SEATS).map(([code, s]) => {
              const active = sigungu.includes(Number(code));
              return (
                <Link
                  key={code}
                  href={toggleSigungu(Number(code))}
                  aria-pressed={active}
                  className={`rounded-lg px-2 py-1.5 text-center text-xs font-bold transition-colors ${
                    active
                      ? "bg-teal-600 text-white shadow-sm"
                      : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-teal-50 hover:text-teal-700"
                  }`}
                >
                  {s.name}
                </Link>
              );
            })}
            {sigungu.length > 0 && (
              <Link
                href={hrefWith({ sigungu: undefined })}
                className="rounded-lg bg-slate-100 px-2 py-1.5 text-center text-xs font-bold text-slate-500 transition-colors hover:bg-slate-200"
              >
                전체 해제 ✕
              </Link>
            )}
          </div>
        </Row>

        <Row label="동행">
          <div className="flex flex-wrap items-center gap-2">
            <ProfileChips
              basePath="/places"
              current={profile}
              extraParams={{ ...currentParams, profile: undefined, fo: "1" }}
            />
            <Link
              href={hrefWith({ pet: pet ? undefined : "1" })}
              aria-pressed={pet}
              className={`inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                pet
                  ? "bg-amber-500 text-white shadow-sm"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-amber-50 hover:text-amber-700"
              }`}
            >
              🐶 반려동물 동반
            </Link>
          </div>
        </Row>

        <Row label="이동수단">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { key: "transit", label: "🚌 대중교통" },
                { key: "car", label: "🚗 자차" },
              ] as const
            ).map((t) => (
              <Link
                key={t.key}
                // tr을 항상 명시 — 생략하면 쿠키(예: car)가 폴백돼 대중교통 전환이 안 됨
                href={hrefWith({ tr: t.key })}
                aria-pressed={transport === t.key}
                className={`inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  transport === t.key
                    ? "bg-slate-700 text-white shadow-sm"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                }`}
              >
                {t.label}
              </Link>
            ))}
            <span className="self-center text-xs text-slate-400">
              자차는 대체지·코스를 더 넓게 (30→50km) 추천해요
            </span>
          </div>
        </Row>

        {anyActive && (
          <div className="flex justify-end border-t border-slate-100 pt-2.5">
            <Link
              href={hrefWith({
                sigungu: undefined,
                profile: undefined,
                pet: undefined,
                // tr 명시 초기화 — 생략하면 쿠키의 car가 폴백된다
                tr: "transit",
              })}
              className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200"
            >
              조건 모두 초기화 ✕
            </Link>
          </div>
        )}
      </div>
    </details>
  );
}
