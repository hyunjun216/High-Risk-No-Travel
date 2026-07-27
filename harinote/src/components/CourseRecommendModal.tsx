"use client";

/**
 * AI 코스 추천 팝업 — 플래너 패널에서 열어 테마·지역을 고르면
 * 서버 액션(recommendCourses)으로 코스를 만들고, 코스를 현재 활성 일차에
 * 통째로 담는다. 동행·이동수단은 검색 필터(여행 조건 패널)에서 자동 상속.
 * (sigungu, profile, transport) 조합당 1회만 호출하고 테마 전환은 로컬 필터.
 */
import {
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import CourseCard from "@/components/CourseCard";
import CourseSigunguPicker from "@/components/CourseSigunguPicker";
import { courseConditionParts } from "@/components/travel-condition";
import { recommendCourses } from "@/lib/course/recommend-action";
import {
  COURSE_THEMES,
  COURSE_THEME_META,
  type CourseTheme,
  type ThemedCourseDto,
} from "@/lib/course/themed";
import { SIGUNGU_SEATS } from "@/lib/risk/regions";
import type { Profile } from "@/lib/safety/types";
import type { Transport } from "@/lib/prefs";

type CourseResult = Record<CourseTheme, ThemedCourseDto | null>;

interface Props {
  /** 목록의 선택 날짜(?date=) — 있으면 코스도 같은 날짜 점수로 생성 (한 화면 두 점수 방지) */
  date?: string;
  /** 검색 필터에서 상속되는 여행 조건 — 모달에선 표시만 하고 편집하지 않는다 */
  profile: Profile;
  transport: Transport;
  /** 검색 필터의 시군 복수선택 — 1곳이면 자동 선택, 2곳 이상이면 그룹 우선 표시 */
  sigunguCodes: number[];
}

export default function CourseRecommendModal({
  date,
  profile,
  transport,
  sigunguCodes,
}: Props) {
  const [open, setOpen] = useState(false);
  const [sigungu, setSigungu] = useState<number | undefined>(undefined);
  const [theme, setTheme] = useState<CourseTheme | undefined>();
  const [result, setResult] = useState<{ key: string; data: CourseResult } | null>(null);
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();
  // 서버 렌더는 false → 클라이언트에서 true. SSR에서
  // document.body를 참조하지 않도록 포털 렌더를 마운트 후로 미룬다.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // 모달 열림 중: ESC로 닫기 + 배경 페이지 스크롤 잠금 (aria-modal 선언과 실동작 일치)
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // 상속 조건(profile/transport)이 페이지에서 바뀌면 키가 달라져 재열기 시 재조회된다
  const keyOf = (code: number) =>
    `${code}:${profile}:${transport}:${date ?? "today"}`;

  const load = (nextSigungu: number) => {
    const key = keyOf(nextSigungu);
    // 서버 액션은 클라이언트당 순차 디스패치라 마지막 요청이 마지막에 반영된다 —
    // 같은 키 재요청도 서버 캐시(10분)를 타므로 스킵 없이 항상 최신으로 수렴시킨다
    setFailed(false);
    startTransition(async () => {
      try {
        const data = await recommendCourses(nextSigungu, profile, date, transport);
        setResult({ key, data });
        // 앞선 요청의 실패가 나중에 정착해도 최신 성공 결과를 가리지 않게 해제
        setFailed(false);
      } catch {
        setFailed(true);
      }
    });
  };

  const selectSigungu = (code: number) => {
    setSigungu(code);
    load(code);
  };

  // 열기: 검색 필터에서 시군 1곳만 골랐다면 자동 선택 + 즉시 생성.
  // 결과 키가 현재 조건과 같으면(재열기) 재조회 없이 유지.
  const openModal = () => {
    setOpen(true);
    const target = sigungu ?? (sigunguCodes.length === 1 ? sigunguCodes[0] : undefined);
    if (target === undefined) return;
    if (sigungu === undefined) setSigungu(target);
    if (result?.key !== keyOf(target)) load(target);
  };

  const ready =
    sigungu !== undefined && result?.key === keyOf(sigungu)
      ? result.data
      : undefined;
  const themesToShow: readonly CourseTheme[] = theme ? [theme] : COURSE_THEMES;

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="w-full rounded-xl bg-teal-600 px-3 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-teal-700"
      >
        🤖 AI 코스 추천
      </button>

      {/* sticky 패널 안은 스태킹 컨텍스트라 z-50이 갇힌다 — body로 포털 (마운트 후에만) */}
      {open &&
        mounted &&
        createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="AI 코스 추천"
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
        >
          {/* 배경 */}
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          {/* 본문 */}
          <div className="relative flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-slate-50 sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3.5">
              <h2 className="text-base font-extrabold text-slate-900">
                🤖 AI 코스 추천
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm font-semibold text-slate-400 transition-colors hover:text-slate-600"
              >
                닫기 ✕
              </button>
            </div>

            <div className="overscroll-contain overflow-y-auto p-4 sm:p-5">
              {/* ── 상속된 여행 조건 (편집은 검색 필터에서) ── */}
              <p className="text-xs font-semibold text-slate-500">
                ⚙️ 여행 조건: {courseConditionParts(profile, transport).join(" · ")}{" "}
                <span className="font-normal text-slate-400">
                  (검색 필터에서 변경)
                </span>
              </p>

              {/* ── 조건 선택 ── */}
              <section className="mt-4">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  여행 테마
                </h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    aria-pressed={theme === undefined}
                    onClick={() => setTheme(undefined)}
                    className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ${
                      theme === undefined
                        ? "bg-teal-600 text-white shadow-sm"
                        : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-teal-50 hover:text-teal-700"
                    }`}
                  >
                    ✨ 전체 3선
                  </button>
                  {COURSE_THEMES.map((t) => {
                    const meta = COURSE_THEME_META[t];
                    const active = theme === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setTheme(active ? undefined : t)}
                        className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ${
                          active
                            ? "bg-teal-600 text-white shadow-sm"
                            : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-teal-50 hover:text-teal-700"
                        }`}
                      >
                        {meta.emoji} {meta.label}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="mt-4">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  지역 선택
                </h3>
                <CourseSigunguPicker
                  selected={sigungu}
                  mine={sigunguCodes}
                  onSelect={selectSigungu}
                />
              </section>

              {/* ── 결과 ── */}
              <section className="mt-5" aria-live="polite">
                {sigungu === undefined ? (
                  <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 px-6 py-10 text-center">
                    <p className="text-3xl" aria-hidden="true">
                      🗺️
                    </p>
                    <p className="mt-2 font-bold text-slate-700">
                      지역을 선택해 주세요
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      오늘의 안전 점수가 높은 곳으로 오전 → 점심 → 오후 코스를
                      만들어 드려요.
                    </p>
                  </div>
                ) : isPending || (!ready && !failed) ? (
                  <p className="py-10 text-center text-sm font-semibold text-slate-500">
                    ⏳ {SIGUNGU_SEATS[sigungu].name} 코스를 만드는 중…
                  </p>
                ) : failed ? (
                  <div className="rounded-2xl bg-red-50 px-6 py-8 text-center ring-1 ring-red-100">
                    <p className="text-sm font-bold text-red-700">
                      코스를 만들지 못했어요
                    </p>
                    <button
                      type="button"
                      onClick={() => load(sigungu)}
                      className="mt-2 rounded-full bg-white px-4 py-1.5 text-xs font-bold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                    >
                      다시 시도
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {themesToShow.map((t) => {
                      const course = ready![t];
                      const meta = COURSE_THEME_META[t];
                      if (!course) {
                        return (
                          <article
                            key={t}
                            className="rounded-2xl bg-white px-6 py-6 text-center ring-1 ring-slate-200"
                          >
                            <p className="font-bold text-slate-700">
                              {meta.emoji} {meta.label}
                            </p>
                            <p className="mt-1 text-sm text-slate-500">
                              이 지역엔 해당 테마 코스를 만들 수 없어요.
                            </p>
                          </article>
                        );
                      }
                      return (
                        <CourseCard
                          key={t}
                          course={course}
                          profile={profile}
                          onAdded={() => setOpen(false)}
                        />
                      );
                    })}
                    <p className="text-xs leading-relaxed text-slate-400">
                      코스는 {date ? `${date} 기준` : "오늘의"} 안전 점수를
                      기준으로 자동 생성된 참고 정보이며 안전을 보장하지
                      않습니다. 방문 전 기상특보와 현지 안내를 확인하세요.
                    </p>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
