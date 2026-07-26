import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getDateSafety,
  getPlaceWithSafety,
  getPlacesWithSafety,
  getPlacesWithSafetyOnDate,
  getPlacesWithSafetyOnRange,
  getRangeSafety,
} from "@/lib/datasource";
import { formatKoreanDate } from "@/lib/date";
import { ENV_TYPE_LABEL, placeTypeLabel } from "@/lib/tour/types";
import { PROFILE_LABEL, RISK_CATEGORY_LABELS } from "@/lib/safety/types";
import { Suspense } from "react";
import { recommendAlternatives } from "@/lib/reco/alternatives";
import { buildHalfDayCourse } from "@/lib/course/half-day";
import CourseTimeline from "@/components/CourseTimeline";
import PlaceCard from "@/components/PlaceCard";
import PlaceGallery from "@/components/PlaceGallery";
import PlaceMap from "@/components/PlaceMap";
import { GallerySection, OverviewSection, PetSection, ReviewsSection } from "./sections";
import { kidsAmenityLabels, kidsInfoOf } from "@/lib/tour/kids-friendly";
import { summaryOf } from "@/lib/tour/summaries";
import AddToPlanButton from "@/components/AddToPlanButton";
import ProfileChips from "@/components/ProfileChips";
import RiskBreakdownBar from "@/components/RiskBreakdownBar";
import SafetyScoreBadge from "@/components/SafetyScoreBadge";
import RangeDayStrip from "@/components/RangeDayStrip";
import {
  parseDateRange,
  parseProfile,
  parseTransport,
  profileParam,
  buildQuery,
  type SearchParamValue,
} from "@/components/search-params";
import { savedProfile, savedTransport } from "@/lib/prefs";
import { CAR_DISTANCE_KM } from "@/lib/reco/alternatives";
import PrefsPersist from "@/components/PrefsPersist";

interface Props {
  params: Promise<{ contentId: string }>;
  searchParams: Promise<Record<string, SearchParamValue>>;
}

function parseContentId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const contentId = parseContentId((await params).contentId);
  if (contentId === null) return { title: "관광지 상세" };
  const place = await getPlaceWithSafety(contentId);
  return { title: place ? `${place.title} 안전 점수` : "관광지 상세" };
}

export default async function PlaceDetailPage({ params, searchParams }: Props) {
  const [{ contentId: rawId }, sp] = await Promise.all([params, searchParams]);
  const contentId = parseContentId(rawId);
  if (contentId === null) notFound();

  // URL 파라미터 우선, 없으면 쿠키에 기억된 조건 (첫 화면에서 저장됨)
  const profile =
    sp.profile !== undefined
      ? parseProfile(sp.profile)
      : ((await savedProfile()) ?? "default");
  const transport = parseTransport(sp.tr) ?? (await savedTransport()) ?? "transit";
  const place = await getPlaceWithSafety(contentId, profile);
  if (!place) notFound();

  // 날짜 모드: D+1~3 예보 / D+4~ 계절 범위. 계산 불가면 오늘 모드 유지.
  // 기간 모드(?date=&end=): 일자별 점수 중 최악일이 대표 — 계산 불가면 단일/오늘로 폴백.
  const { start: date, end } = parseDateRange(sp.date, sp.end);
  const rangeSafety =
    date && end ? await getRangeSafety(place, profile, date, end) : null;
  const dateSafety = rangeSafety
    ? rangeSafety.worst
    : date
      ? await getDateSafety(place, profile, date)
      : null;
  const activeDate = dateSafety ? date : undefined;
  const activeEnd = rangeSafety ? end : undefined;

  // 대표 점수(랭킹·대체지 비교 기준): 오늘 점수 또는 날짜/최악일 점수(계절은 통상일)
  const safety = dateSafety ? dateSafety.breakdown : place.safety;
  // 분석 섹션(감점 요약·요인 상세) 기준: 계절 모드는 궂은날 — "무엇을 주의할지"가 목적.
  // 기간 모드에서도 최악일에 같은 규칙을 적용한다 (단일 날짜와 동일 관계).
  const analysisSafety = dateSafety?.seasonal ? dateSafety.seasonal.bad : safety;

  // 대체지 추천: 전체 후보(요청 스코프 캐시로 재로드 비용 없음)에서 30km 이내 더 안전한 곳.
  // 날짜/기간 모드에서는 후보도 같은 기준으로 계산해 공정하게 비교한다.
  // 사진 갤러리(detailImage2)·후기(네이버)는 느린 외부 API라 Suspense로 스트리밍한다.
  const candidates =
    activeDate && activeEnd
      ? await getPlacesWithSafetyOnRange(profile, activeDate, activeEnd)
      : activeDate
        ? await getPlacesWithSafetyOnDate(profile, activeDate)
        : await getPlacesWithSafety(undefined, profile);

  // 자차는 후보 반경 확대 (대체지 30→50km, 코스 ×1.5) — 직선거리 기준 후보 추리기
  const altMaxKm = transport === "car" ? CAR_DISTANCE_KM : undefined;
  const alternatives = recommendAlternatives(
    { ...place, safety },
    candidates,
    undefined,
    altMaxKm,
  );

  // 안전 반나절 코스: 앵커(target 또는 대체지 1순위) + 음식점 + 관광지·문화시설
  const course = buildHalfDayCourse(
    { ...place, safety },
    alternatives,
    candidates,
    transport === "car" ? 1.5 : 1,
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PrefsPersist profile={profile} transport={transport} />
      <Link
        href={`/places${buildQuery({ profile: profileParam(profile) })}`}
        className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 transition-colors hover:text-teal-700"
      >
        <span aria-hidden="true">←</span> 목록으로
      </Link>

      {/* ── 히어로: 좌 갤러리 · 우 제목·점수·프로필 ── */}
      <div className="mt-4 grid items-start gap-6 lg:grid-cols-2">
        {/* 좌: 사진 갤러리 — 대표사진 즉시, detailImage2 추가 사진은 스트리밍 */}
        <Suspense
          fallback={
            <PlaceGallery
              title={place.title}
              envType={place.envType}
              images={place.imageUrl ? [place.imageUrl] : []}
            />
          }
        >
          <GallerySection
            contentId={contentId}
            title={place.title}
            envType={place.envType}
            imageUrl={place.imageUrl}
          />
        </Suspense>

        {/* 우: 제목·주소·뱃지 + 안전 점수 + 프로필 */}
        <div>
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-700 ring-1 ring-teal-200">
              {placeTypeLabel(place)}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
              {ENV_TYPE_LABEL[place.envType]}
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
            {place.title}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500 sm:text-base">
            {place.addr}
            {place.tel && (
              <span className="ml-2 text-slate-400">{place.tel}</span>
            )}
          </p>

          {/* AI 3줄 요약 — 이름·주소 바로 아래에서 "어떤 곳인지" 즉시 파악 */}
          {(() => {
            const summary = summaryOf(place.contentId);
            if (!summary) return null;
            return (
              <div className="mt-3 rounded-xl bg-sky-50/60 px-4 py-3 ring-1 ring-sky-100">
                <p className="text-xs font-bold text-sky-700">
                  ⚡ 핵심 3줄
                  <span className="ml-1.5 font-medium text-sky-400">AI 요약</span>
                </p>
                <ul className="mt-1 space-y-0.5 text-sm leading-relaxed text-slate-700">
                  {summary.map((line) => (
                    <li key={line}>· {line}</li>
                  ))}
                </ul>
              </div>
            );
          })()}

          <div className="mt-6">
            {dateSafety?.seasonal ? (
              /* 계절 모드: 개별 날짜 예보가 없어 단일 점수를 단정하지 않고 범위로 안내 */
              <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
                <p className="text-xs font-medium text-slate-500">
                  {rangeSafety
                    ? `기간 중 가장 주의가 필요한 날(${formatKoreanDate(dateSafety.dateISO)}) 기준 — `
                    : `${formatKoreanDate(dateSafety.dateISO)} 방문 — `}
                  {dateSafety.seasonal.month}월 · 30년 기후 기준
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-400">통상일</p>
                    <SafetyScoreBadge
                      score={dateSafety.seasonal.typical.score}
                      grade={dateSafety.seasonal.typical.grade}
                    />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-400">궂은날</p>
                    <SafetyScoreBadge
                      score={dateSafety.seasonal.bad.score}
                      grade={dateSafety.seasonal.bad.grade}
                    />
                  </div>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  먼 날짜는 날씨를 예보할 수 없어요. 이 시기 30년 기후에서
                  평범한 날과 궂은 날(상위 10%)의 점수 범위입니다.
                </p>
              </div>
            ) : (
              <SafetyScoreBadge
                score={safety.score}
                grade={safety.grade}
                size="lg"
                label={
                  dateSafety
                    ? rangeSafety
                      ? `기간 중 가장 주의가 필요한 날(${formatKoreanDate(dateSafety.dateISO)}) 예보 기준 안전 점수`
                      : `${formatKoreanDate(dateSafety.dateISO)} 예보 기준 안전 점수`
                    : "오늘의 안전 점수"
                }
              />
            )}
            {dateSafety?.mode === "forecast" && (
              <p className="mt-2 text-xs text-slate-400">
                기상은 {dateSafety.dayOffset}일 후 예보, 미세먼지·산불위험은
                현재값 기준입니다.
              </p>
            )}
            {/* 기간 일자별 점수 — 셀 클릭 시 그날 단일 날짜로 드릴다운 */}
            {rangeSafety && (
              <div className="mt-3">
                <RangeDayStrip
                  range={rangeSafety}
                  basePath={`/places/${place.contentId}`}
                  extraParams={{ profile: profileParam(profile) }}
                />
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <AddToPlanButton
                item={{
                  contentId: place.contentId,
                  title: place.title,
                  lat: place.lat,
                  lng: place.lng,
                  score: safety.score,
                }}
              />
              <Link
                href={`/places/${place.contentId}/report${buildQuery({ profile: profileParam(profile) })}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-4 py-1.5 text-sm font-semibold text-teal-700 ring-1 ring-teal-200 transition-colors hover:bg-teal-100"
              >
                <span aria-hidden="true">📋</span> 출발 전 체크 리포트
              </Link>
              <a
                href={`https://search.naver.com/search.naver?query=${encodeURIComponent(place.title)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-100"
              >
                <span aria-hidden="true">🔍</span> 네이버에서 자세히 보기
              </a>
              <a
                href={`https://map.kakao.com/link/to/${encodeURIComponent(place.title)},${place.lat},${place.lng}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-100"
              >
                <span aria-hidden="true">🧭</span> 길찾기 (실제 소요시간)
              </a>
            </div>
            {/* 날짜는 홈에서 정한 여행 날짜 기준 (여기선 표시만) */}
            {activeDate && (
              <p className="mt-3 text-xs font-semibold text-sky-700">
                {formatKoreanDate(activeDate)}
                {activeEnd ? ` ~ ${formatKoreanDate(activeEnd)}` : ""} 여행
                기준 점수예요
              </p>
            )}
            <div className="mt-4">
              <p className="mb-2 text-sm font-semibold text-slate-600">
                동행에 따라 점수가 달라져요 —{" "}
                <strong className="text-teal-700">
                  {PROFILE_LABEL[profile]} 기준
                </strong>
              </p>
              <ProfileChips
                basePath={`/places/${place.contentId}`}
                current={profile}
                extraParams={{ date: activeDate, end: activeEnd }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── 본문: 좌 안전 분석 · 우 주변·행동 ── */}
      <div className="mt-8 grid items-start gap-x-6 gap-y-8 lg:grid-cols-2">
        {/* 좌 컬럼: 왜 이 점수인가 (분석) */}
        <div className="space-y-8">
          {/* 카테고리 소계 */}
          <section>
            <h2 className="text-lg font-bold text-slate-900">
              분야별 감점 요약
              {dateSafety?.seasonal && (
                <span className="ml-2 text-sm font-semibold text-slate-400">
                  궂은날 기준
                </span>
              )}
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {RISK_CATEGORY_LABELS.map((c) => {
                const points = analysisSafety[c.key];
                return (
                  <div
                    key={c.key}
                    className="rounded-xl bg-white p-4 text-center ring-1 ring-slate-200"
                  >
                    <span className="text-2xl" aria-hidden="true">
                      {c.icon}
                    </span>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      {c.label}
                    </p>
                    <p
                      className={`text-lg font-extrabold tabular-nums ${
                        points > 0 ? "text-slate-800" : "text-slate-300"
                      }`}
                    >
                      −{points}점
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 요인별 상세 — 계절 모드는 궂은날 시나리오 기준 (무엇을 주의할지) */}
          <section>
            <h2 className="text-lg font-bold text-slate-900">
              {dateSafety?.seasonal
                ? "궂은날엔 이런 점을 주의하세요"
                : "왜 이 점수인가요?"}
            </h2>
            <div className="mt-3">
              <RiskBreakdownBar factors={analysisSafety.factors} />
            </div>
          </section>

          {/* 소개 — TourAPI detailCommon2 실시간 조회 (스트리밍, 없으면 숨김) */}
          <Suspense fallback={null}>
            <OverviewSection contentId={contentId} fallback={place.overview} />
          </Suspense>

          {/* 반려동물 동반 정보 — detailPetTour2 실시간 (없으면 숨김) */}
          <Suspense fallback={null}>
            <PetSection contentId={contentId} />
          </Suspense>

          {/* 유아 동반 편의시설 — 한국문화정보원 데이터 (없으면 숨김) */}
          {(() => {
            const kids = kidsInfoOf(place.contentId);
            if (!kids) return null;
            const amenities = kidsAmenityLabels(kids);
            return (
              <section>
                <h2 className="text-lg font-bold text-slate-900">
                  👶 아이와 함께
                </h2>
                <div className="mt-2 rounded-xl bg-white p-4 text-sm leading-relaxed text-slate-600 ring-1 ring-slate-200">
                  {amenities.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {amenities.map((a) => (
                        <span
                          key={a}
                          className="rounded-full bg-pink-50 px-2.5 py-0.5 text-xs font-semibold text-pink-700 ring-1 ring-pink-200"
                        >
                          {a}
                        </span>
                      ))}
                    </div>
                  )}
                  {kids.age && (
                    <p className={amenities.length > 0 ? "mt-2" : ""}>
                      <span className="font-semibold text-slate-700">입장 가능 나이: </span>
                      {kids.age}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-slate-400">
                    한국문화정보원 유아 동반 시설 데이터 (2022년 조사 기준) —
                    방문 전 시설에 확인을 권장해요.
                  </p>
                </div>
              </section>
            );
          })()}

          {/* 안전한 대체지 추천 */}
          <section>
            <h2 className="text-lg font-bold text-slate-900">안전한 대체지 추천</h2>
            <p className="mt-1 text-sm text-slate-500">
              같은 유형의 더 안전한 주변 관광지예요 — {transport === "car" ? `자차 기준 ${CAR_DISTANCE_KM}km` : "대중교통 기준 30km"} 이내 (직선거리)
            </p>
            {alternatives.length === 0 ? (
              <div className="mt-3 rounded-2xl bg-teal-50/50 px-6 py-10 text-center ring-1 ring-teal-100">
                <p className="text-3xl" aria-hidden="true">
                  🧭
                </p>
                <p className="mt-3 font-bold text-slate-700">
                  이 관광지는 주변 대비 이미 주의 요인이 낮은 편이에요
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  30km 이내에서 안전 점수가 의미 있게 더 높은 관광지를 찾지
                  못했어요.
                </p>
                <Link
                  href={`/places${buildQuery({ profile: profileParam(profile) })}`}
                  className="mt-4 inline-block rounded-full bg-teal-50 px-4 py-1.5 text-sm font-semibold text-teal-700 ring-1 ring-teal-200 transition-colors hover:bg-teal-100"
                >
                  다른 관광지 둘러보기
                </Link>
              </div>
            ) : (
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {alternatives.map((alt) => (
                  <PlaceCard
                    key={alt.contentId}
                    place={alt}
                    profile={profile}
                    date={activeDate}
                    end={activeEnd}
                    footer={
                      <p className="text-xs font-semibold text-teal-700">
                        {alt.distanceKm.toFixed(1)}km · 안전점수 +
                        {alt.safety.score - safety.score}점
                      </p>
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* 우 컬럼: 그래서 어디로·무엇을 (행동) */}
        <div className="space-y-8">
          {/* 위치 지도 */}
          <section>
            <h2 className="text-lg font-bold text-slate-900">위치 보기</h2>
            <p className="mb-3 mt-1 text-sm text-slate-500">
              <span className="font-semibold text-teal-800">●</span> 현재 관광지
              {alternatives.length > 0 && (
                <>
                  {" · "}
                  <span className="font-semibold text-emerald-500">●</span> 더
                  안전한 대체지
                </>
              )}
            </p>
            <PlaceMap
              target={{
                contentId: place.contentId,
                title: place.title,
                lat: place.lat,
                lng: place.lng,
                score: safety.score,
              }}
              alternatives={alternatives.map((alt) => ({
                contentId: alt.contentId,
                title: alt.title,
                lat: alt.lat,
                lng: alt.lng,
                score: alt.safety.score,
                distanceKm: alt.distanceKm,
              }))}
              profileQuery={buildQuery({
                profile: profileParam(profile),
                date: activeDate,
                end: activeEnd,
              })}
            />
          </section>

          {/* 추천 반나절 코스 */}
          {course && (
            <section>
              <h2 className="text-lg font-bold text-slate-900">추천 반나절 코스</h2>
              <p className="mt-1 text-sm text-slate-500">
                {course.anchoredOnAlternative
                  ? `오늘은 ${place.title} 대신 더 안전한 코스를 추천해요`
                  : `${place.title}에서 시작하는 안전 코스예요`}
              </p>
              <CourseTimeline course={course} profile={profile} />
            </section>
          )}

          {/* 방문 후기 — 네이버 블로그 검색 (스트리밍, 후기 없으면 섹션 숨김) */}
          <Suspense fallback={null}>
            <ReviewsSection title={place.title} />
          </Suspense>
        </div>
      </div>

      <p className="mt-8 text-xs leading-relaxed text-slate-400">
        본 점수는 공공데이터 기반 참고 정보이며 안전을 보장하지 않습니다. 방문
        전 기상특보와 현지 안내를 확인하세요.
      </p>
    </div>
  );
}
