/**
 * 계획 리포트 — 여행 계획 전체를 한 장으로.
 * 일차별로 각 스톱을 그 날짜 기준(실황/예보/계절 통계)으로 재채점해
 * 주의 요인·준비물·응급 대비·대체 플랜을 인쇄·공유 가능한 문서로 제공한다.
 * 계획은 URL 쿼리(?s=contentId.day,…)로 직렬화되어 서버에서 렌더된다.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { diagnosePlan } from "@/lib/plan/diagnose-action";
import { STOP_MODE_LABEL, type StopDiagnosisDto } from "@/lib/plan/diagnose";
import { parseReportQuery } from "@/lib/plan/report-params";
import { getPlace } from "@/lib/datasource";
import type { Place } from "@/lib/tour/types";
import { buildPlanChecklist } from "@/lib/report/checklist";
import { medicalDataSource, nearestHospital } from "@/lib/risk/medical";
import { hasLiveRiskKeys } from "@/lib/risk/live";
import { hasForestKey } from "@/lib/risk/forest";
import { GRADE_LABEL, PROFILE_LABEL } from "@/lib/safety/types";
import { totalDistanceKm } from "@/lib/travel-plan";
import { addDaysISO, formatKoreanDate } from "@/lib/date";
import { parseProfile, type SearchParamValue } from "@/components/search-params";
import ReportActions from "@/components/ReportActions";

interface Props {
  searchParams: Promise<Record<string, SearchParamValue>>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const q = parseReportQuery(sp.s, sp.from, sp.name);
  return { title: q?.name ? `${q.name} 계획 리포트` : "여행 계획 리포트" };
}

const GRADE_TEXT_CLASS = {
  low: "text-teal-600",
  moderate: "text-amber-600",
  high: "text-red-600",
} as const;

interface ReportRow {
  stop: StopDiagnosisDto;
  place: Place;
}

export default async function PlanReportPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = parseReportQuery(sp.s, sp.from, sp.name);
  if (!q) notFound();

  const profile = parseProfile(sp.profile);
  const transport = sp.tr === "car" ? ("car" as const) : ("transit" as const);

  const [diagnosis, places] = await Promise.all([
    diagnosePlan({ items: q.stops, from: q.from, profile, transport }),
    Promise.all(q.stops.map((st) => getPlace(st.contentId))),
  ]);

  // 데이터에 없는 contentId(깨진 공유 링크 등)는 제외 — 전부 없으면 404
  const rows: ReportRow[] = [];
  q.stops.forEach((st, i) => {
    const place = places[i];
    const stop = diagnosis.stops[i];
    if (place && stop) rows.push({ stop, place });
  });
  if (rows.length === 0) notFound();

  const days = Math.max(...rows.map((r) => r.stop.day));
  const byDay: ReportRow[][] = Array.from({ length: days }, (_, i) =>
    rows.filter((r) => r.stop.day === i + 1),
  );

  const scored = rows.filter((r) => r.stop.score !== null);
  const worst =
    scored.length > 0
      ? scored.reduce((w, r) => ((r.stop.score ?? 100) < (w.stop.score ?? 100) ? r : w))
      : null;
  const riskyRows = rows.filter(
    (r) => r.stop.grade !== null && r.stop.grade !== "low",
  );

  const checklist = buildPlanChecklist(
    rows.map((r) => ({
      riskFactors: r.stop.riskFactors,
      envType: r.place.envType,
    })),
    profile,
  );

  const dayLabel = (day: number) =>
    q.from ? `${day}일차 · ${formatKoreanDate(addDaysISO(q.from, day - 1))}` : `${day}일차`;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 print:max-w-none print:px-0 print:py-0">
      {/* 인쇄 시 사이트 헤더·푸터 숨김 + A4 맞춤 — 이 라우트에만 적용 */}
      <style>{`
        @media print {
          @page { size: A4; margin: 10mm 12mm; }
          body > header, body > footer { display: none !important; }
          body { background: #fff !important; }
          section { break-inside: avoid; }
        }
      `}</style>

      <Link
        href="/plans"
        className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 transition-colors hover:text-teal-700 print:hidden"
      >
        <span aria-hidden="true">←</span> 내 여행으로 돌아가기
      </Link>

      <article className="mt-4 rounded-2xl bg-white p-6 ring-1 ring-slate-200 print:mt-0 print:rounded-none print:p-0 print:ring-0">
        {/* ① 헤더 */}
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4 print:pb-3">
          <div>
            <p className="text-xs font-bold tracking-wide text-teal-700">
              하리노트 · 여행 계획 리포트
            </p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900 print:text-xl">
              {q.name ?? "내 여행 계획"}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {q.from
                ? `${formatKoreanDate(q.from)} 출발 · ${days === 1 ? "당일" : `${days - 1}박 ${days}일`}`
                : `${days === 1 ? "당일" : `${days}일`} 일정 · 출발일 미설정(오늘 출발 기준)`}
              {" · "}
              {PROFILE_LABEL[profile]} 기준 · 스톱 {rows.length}곳
            </p>
          </div>
          <ReportActions />
        </header>

        {/* ② 계획 요약 */}
        <section className="mt-5 print:mt-4">
          {riskyRows.length === 0 ? (
            <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200">
              전 스톱 방문 주의 요인 낮음 — 일정 그대로 진행해도 좋아요
            </p>
          ) : (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 ring-1 ring-amber-200">
              주의 스톱 {riskyRows.length}곳
              {worst && worst.stop.score !== null && (
                <>
                  {" — 가장 주의가 필요한 곳: "}
                  <strong>{worst.place.title}</strong>{" "}
                  <span className="tabular-nums">({worst.stop.score}점)</span>
                </>
              )}
            </p>
          )}
        </section>

        {/* ③ 일차별 점검 */}
        {byDay.map((dayRows, i) =>
          dayRows.length === 0 ? null : (
            <section key={i} className="mt-6 print:mt-4">
              <h2 className="text-base font-bold text-slate-900">{dayLabel(i + 1)}</h2>
              <ul className="mt-2 space-y-2">
                {dayRows.map(({ stop, place }) => {
                  const hospital = nearestHospital(place.lat, place.lng, place.contentId);
                  return (
                    <li
                      key={stop.contentId}
                      className="rounded-xl bg-slate-50 px-4 py-2.5 ring-1 ring-slate-200"
                    >
                      <p className="text-sm font-bold text-slate-800">
                        <Link
                          href={`/places/${place.contentId}`}
                          className="hover:underline"
                        >
                          {place.title}
                        </Link>
                        {stop.score !== null && stop.grade !== null ? (
                          <span
                            className={`float-right font-extrabold tabular-nums ${GRADE_TEXT_CLASS[stop.grade]}`}
                          >
                            {stop.grade !== "low" && "⚠ "}
                            {stop.score}점
                          </span>
                        ) : (
                          <span className="float-right text-xs font-semibold text-slate-400">
                            점수 데이터 없음
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {stop.grade !== null && (
                          <>
                            {GRADE_LABEL[stop.grade]}
                            <span className="text-slate-300"> · </span>
                          </>
                        )}
                        {STOP_MODE_LABEL[stop.mode]}
                        {stop.topFactors.length > 0 && (
                          <>
                            <span className="text-slate-300"> · </span>
                            {stop.topFactors
                              .map((f) => `${f.label} −${f.points}점`)
                              .join(" · ")}
                          </>
                        )}
                        {hospital && (
                          <>
                            <span className="text-slate-300"> · </span>
                            응급의료 {hospital.name}{" "}
                            <span className="tabular-nums">
                              {hospital.km.toFixed(1)}km
                            </span>
                          </>
                        )}
                      </p>
                    </li>
                  );
                })}
              </ul>
              {dayRows.length >= 2 && (
                <p className="mt-1.5 text-xs font-semibold text-slate-500">
                  이동 직선{" "}
                  <span className="tabular-nums">
                    {totalDistanceKm(
                      dayRows.map(({ place }) => ({
                        contentId: place.contentId,
                        title: place.title,
                        lat: place.lat,
                        lng: place.lng,
                      })),
                    )}
                    km
                  </span>{" "}
                  — 실제 소요 시간은 지도 앱에서 확인하세요
                </p>
              )}
            </section>
          ),
        )}

        {/* ④ 준비물 체크리스트 */}
        <section className="mt-6 print:mt-4">
          <h2 className="text-base font-bold text-slate-900">준비물 체크리스트</h2>
          <ul className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2 print:grid-cols-2">
            {checklist.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-slate-700">
                <span
                  aria-hidden="true"
                  className="mt-0.5 inline-block h-4 w-4 shrink-0 rounded border border-slate-300"
                />
                {item}
              </li>
            ))}
          </ul>
        </section>

        {/* ⑤ 대체 플랜 — 주의 스톱의 같은 날짜 기준 교체 후보 */}
        {riskyRows.some((r) => r.stop.alternatives.length > 0) && (
          <section className="mt-6 print:mt-4">
            <h2 className="text-base font-bold text-slate-900">대체 플랜</h2>
            <ul className="mt-2 space-y-1.5">
              {riskyRows.flatMap(({ stop, place }) =>
                stop.alternatives.length === 0
                  ? []
                  : [
                      <li key={stop.contentId} className="text-sm text-slate-700">
                        <strong className="font-bold text-slate-900">
                          {place.title}
                        </strong>
                        <span className="text-slate-400"> 대신 → </span>
                        {stop.alternatives.map((alt, j) => (
                          <span key={alt.contentId}>
                            {j > 0 && <span className="text-slate-300"> · </span>}
                            <Link
                              href={`/places/${alt.contentId}`}
                              className="font-bold text-teal-700 hover:underline print:text-slate-900"
                            >
                              {alt.title}
                            </Link>{" "}
                            <span className="tabular-nums">
                              ({alt.score}점 · {alt.distanceKm}km)
                            </span>
                          </span>
                        ))}
                      </li>,
                    ],
              )}
            </ul>
          </section>
        )}

        {/* ⑥ 응급 안내 + 푸터 */}
        <section className="mt-6 print:mt-4">
          <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm font-bold text-red-700 ring-1 ring-slate-200">
            위급 시 지체 없이 119에 신고하세요.
          </p>
        </section>

        <footer className="mt-6 border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-400 print:mt-4">
          <p>
            본 리포트는 공공데이터 기반 참고 정보이며 안전을 보장하지 않습니다.
            방문 전 기상특보와 현지 안내를 반드시 확인하세요. 미래 일차 점수는
            단기예보(내일~3일 뒤) 또는 30년 계절 통계 기준 추정치입니다.
          </p>
          <p className="mt-1">
            데이터 출처: 한국관광공사 TourAPI · {medicalDataSource()}
            {hasLiveRiskKeys()
              ? hasForestKey()
                ? " · 기상청 · AirKorea(한국환경공단) · 산림청(산불위험예보)."
                : " · 기상청 · AirKorea(한국환경공단). 산불위험은 실연동 준비 중인 시범값입니다."
              : ". 기상·미세먼지·산불위험은 시범값 기준입니다."}
          </p>
        </footer>
      </article>
    </div>
  );
}
