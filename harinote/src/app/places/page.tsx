import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  getPlacesWithSafety,
  getPlacesWithSafetyOnDate,
  getPlacesWithSafetyOnRange,
  matchesPlaceQuery,
  type PlaceWithSafety,
} from "@/lib/datasource";
import type { Profile } from "@/lib/safety/types";
import type { PlanDragPayload } from "@/lib/travel-plan";
import { dayOffsetSeoul, formatKoreanDate } from "@/lib/date";
import {
  CAT3_CAFE_LABEL,
  CONTENT_TYPE_LABEL,
  SUPPORTED_CONTENT_TYPE_IDS,
} from "@/lib/tour/types";
import PlaceCard from "@/components/PlaceCard";
import PlannerCard from "@/components/PlannerCard";
import PopularSidebar from "@/components/PopularSidebar";
import TravelPlannerPanel from "@/components/TravelPlannerPanel";
import PlannerDrawer from "@/components/PlannerDrawer";
import PrefsPersist from "@/components/PrefsPersist";
import { savedTransport } from "@/lib/prefs";
import SearchBox from "@/components/SearchBox";
import TravelFilterPanel from "@/components/TravelFilterPanel";
import {
  buildQuery,
  first,
  parseDateRange,
  parsePage,
  parsePet,
  parsePlaceType,
  parseProfile,
  parseSigunguList,
  parseTransport,
  placeTypeToQuery,
  profileParam,
  sigunguParam,
  sigunguSummaryLabel,
  type PlaceTypeParam,
  type SearchParamValue,
} from "@/components/search-params";
import { getLodgingsWithSafety } from "@/lib/tour/lodging-safety";
import { isPetFriendly } from "@/lib/tour/pet-friendly";

const PAGE_SIZE = 24;

export const metadata: Metadata = {
  title: "관광지 검색",
};

const TYPE_TABS: { label: string; value?: PlaceTypeParam }[] = [
  { label: "전체" },
  ...SUPPORTED_CONTENT_TYPE_IDS.map((id) => ({
    label: CONTENT_TYPE_LABEL[id],
    value: id as PlaceTypeParam,
  })),
  // 카페는 음식점(39)의 소분류(cat3) 서브셋 — 음식점 탭에도 포함된 채 별도 탭 제공
  { label: CAT3_CAFE_LABEL, value: "cafe" },
  // 숙박은 별도 내장 데이터셋(lodging.gangwon.json) — 전체 탭에는 포함되지 않는다
  { label: CONTENT_TYPE_LABEL[32], value: "lodging" },
];

interface Props {
  searchParams: Promise<Record<string, SearchParamValue>>;
}

/** 드래그·담기 페이로드 — 클라이언트 카드 래퍼로 직렬화되는 최소 필드만 추린다 */
function planItemOf(place: PlaceWithSafety): PlanDragPayload {
  return {
    contentId: place.contentId,
    title: place.title,
    lat: place.lat,
    lng: place.lng,
    score: place.safety.score,
    contentTypeId: place.contentTypeId,
    // 숙박은 계획 패널·리포트가 kind로 분기 (상세 링크 없음, 숙소 슬롯 표시)
    ...(place.contentTypeId === 32 ? { kind: "lodging" as const } : {}),
  };
}

export default async function PlacesPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = first(sp.q)?.trim() ?? "";
  const placeType = parsePlaceType(sp.type);
  const profile = parseProfile(sp.profile);
  const sigunguCodes = parseSigunguList(sp.sigungu);
  const sigunguLabel =
    sigunguCodes.length > 0 ? sigunguSummaryLabel(sigunguCodes) : undefined;
  // 여행 조건 패널 열림 유지 플래그 — 패널 내부 링크에만 실린다 (currentParams에 넣지 말 것)
  const filtersOpen = first(sp.fo) === "1";

  // 날짜·기간 모드 (홈 날짜 스테퍼에서 전달, 기간은 URL 직접 지정)
  // 단일: 그날 기준 점수 / 기간: 기간 중 최악일 대표점수로 목록 구성
  const { start: date, end } = parseDateRange(sp.date, sp.end);
  // 반려동물 동반 필터 (TourAPI detailPetTour2 수집분)
  const pet = parsePet(sp.pet);
  const petParam = pet ? "1" : undefined;
  // 이동 수단 (상세의 대체지·코스 반경에 반영) — URL 우선, 없으면 쿠키 기억값
  const transport =
    parseTransport(sp.tr) ?? (await savedTransport()) ?? "transit";
  const page = parsePage(sp.page);

  // 링크들이 공유하는 현재 조건 — 각 링크는 바꿀 파라미터만 덮어쓴다
  const currentParams = {
    q: q || undefined,
    type: placeType,
    sigungu: sigunguParam(sigunguCodes),
    profile: profileParam(profile),
    date,
    end,
    pet: petParam,
    tr: transport === "transit" ? undefined : transport,
  };

  // 결과 영역만 Suspense로 격리 — 같은 세그먼트 내 searchParams 전환은 loading.tsx가
  // 뜨지 않으므로, 결과에 영향 주는 파라미터를 key로 걸어 전환마다 폴백 표시를 보장한다.
  // 셸(검색창·필터·패널)은 전량 점수 조회를 기다리지 않고 즉시 그려진다.
  const resultsKey = [
    q,
    placeType ?? "",
    profile,
    sigunguCodes.join("."),
    date ?? "",
    end ?? "",
    petParam ?? "",
    page,
  ].join("|");

  return (
    // 모바일: flex-col + order로 검색 결과가 인기 TOP10보다 먼저 (블록 레이아웃에선 order가 무시됨)
    <div className="mx-auto flex max-w-[84rem] flex-col px-4 py-8 lg:grid lg:grid-cols-[240px_minmax(0,1fr)_380px] lg:items-start lg:gap-6">
      {/* 좌: 인기 관광지 (lg에서 왼쪽 sticky, 모바일은 본문 아래) */}
      <div className="order-2 mt-10 lg:order-1 lg:mt-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
        <PopularSidebar profile={profile} />
      </div>

      <div className="order-1 lg:order-2">
        {/* 모바일 검색 (md+는 네비바 전역 검색 사용) */}
        <div className="max-w-2xl md:hidden">
          <SearchBox
            defaultQuery={q}
            profile={profile}
            date={date}
            end={end}
            sigungu={sigunguParam(sigunguCodes)}
            compact
          />
        </div>

      <div className="mt-5 space-y-3">
        {/* 여행 조건 — 여정 내내 고정되는 필터(지역·동행·이동수단)를 접이식 패널 하나로 */}
        <TravelFilterPanel
          sigungu={sigunguCodes}
          profile={profile}
          pet={pet}
          transport={transport}
          currentParams={currentParams}
          open={filtersOpen}
        />

        {/* 콘텐츠 종류 탭 — 코스를 짜며 자주 바꾸는 필터라 여행 조건 아래 배치 */}
        <nav
          aria-label="관광지 종류 필터"
          className="flex flex-wrap gap-2 border-t border-slate-100 pt-3"
        >
          {TYPE_TABS.map((tab) => {
            const active = tab.value === placeType;
            const href = `/places${buildQuery({ ...currentParams, type: tab.value })}`;
            return (
              <Link
                key={tab.label}
                href={href}
                aria-current={active ? "true" : undefined}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <PrefsPersist profile={profile} transport={transport} />

      <Suspense key={resultsKey} fallback={<ResultsSkeleton />}>
        <PlacesResults
          q={q}
          placeType={placeType}
          profile={profile}
          sigunguCodes={sigunguCodes}
          sigunguLabel={sigunguLabel}
          date={date}
          end={end}
          pet={pet}
          page={page}
          currentParams={currentParams}
        />
      </Suspense>
      </div>

      {/* 우: 내 여행 계획 (lg에서만 sticky — 모바일은 하단 서랍) */}
      <div className="order-3 hidden lg:sticky lg:top-20 lg:block lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
        <TravelPlannerPanel
          courseDate={date}
          profile={profile}
          transport={transport}
          sigunguCodes={sigunguCodes}
        />
      </div>

      {/* 모바일 계획 서랍 (lg:hidden 내장) */}
      <PlannerDrawer
        courseDate={date}
        profile={profile}
        transport={transport}
        sigunguCodes={sigunguCodes}
      />
    </div>
  );
}

/** 결과 목록 — 전량 안전점수 조회를 이 서브트리에 격리해 셸이 먼저 스트리밍되게 한다 */
async function PlacesResults({
  q,
  placeType,
  profile,
  sigunguCodes,
  sigunguLabel,
  date,
  end,
  pet,
  page: pageParam,
  currentParams,
}: {
  q: string;
  placeType: PlaceTypeParam | undefined;
  profile: Profile;
  sigunguCodes: number[];
  sigunguLabel: string | undefined;
  date: string | undefined;
  end: string | undefined;
  pet: boolean;
  page: number;
  currentParams: Record<string, string | number | undefined>;
}) {
  // 기본 정렬 = 안전점수 높은 순 — "어디가 안전한가"가 서비스의 축이므로
  // 데이터 순서(사실상 가나다)가 아니라 점수가 목록의 기준이어야 한다.
  // 전량 점수는 10분 메모리 캐시(오늘/날짜별)를 재사용해 부담 없음.
  // 숙박 탭은 별도 내장 데이터셋 — 이후 필터·정렬·페이지네이션은 동일 경로를 탄다.
  const all =
    placeType === "lodging"
      ? await getLodgingsWithSafety(profile, date, end)
      : date
        ? end
          ? await getPlacesWithSafetyOnRange(profile, date, end)
          : await getPlacesWithSafetyOnDate(profile, date)
        : await getPlacesWithSafety(undefined, profile);
  const places = all
    .filter((p) =>
      matchesPlaceQuery(p, {
        q: q || undefined,
        ...placeTypeToQuery(placeType),
      }),
    )
    // 시군 복수선택 — PlaceQuery는 단일값 계약이라 pet/kids처럼 후필터
    .filter(
      (p) =>
        sigunguCodes.length === 0 ||
        (p.sigunguCode !== undefined && sigunguCodes.includes(p.sigunguCode)),
    )
    .filter((p) => !pet || isPetFriendly(p.contentId))
    .sort((a, b) => b.safety.score - a.safety.score);

  // 서버 사이드 페이지네이션 — 24건/페이지.
  const totalPages = Math.max(1, Math.ceil(places.length / PAGE_SIZE));
  const page = Math.min(pageParam, totalPages);
  const start = (page - 1) * PAGE_SIZE;
  const pagePlaces = places.slice(start, start + PAGE_SIZE);

  const pageHref = (p: number) =>
    `/places${buildQuery({ ...currentParams, page: p === 1 ? undefined : p })}`;

  return (
    <>
      <p className="mt-6 flex flex-wrap items-center gap-2 text-sm text-slate-500">
        <span>
          {date && (
            <strong className="text-sky-700">
              {end ? (
                <>
                  {formatKoreanDate(date)}~{formatKoreanDate(end)} 기준 (기간 중
                  가장 주의가 필요한 날 점수)
                </>
              ) : (
                <>
                  {formatKoreanDate(date)} 기준
                  {dayOffsetSeoul(date) >= 4 && " (30년 기후, 통상일 점수)"}
                </>
              )}
              {" · "}
            </strong>
          )}
          {sigunguLabel && (
            <strong className="text-slate-800">{sigunguLabel} </strong>
          )}
          {q ? (
            <>
              <strong className="text-slate-800">&ldquo;{q}&rdquo;</strong>{" "}
              검색 결과{" "}
            </>
          ) : sigunguLabel ? (
            "관광지 "
          ) : (
            "강원 관광지 "
          )}
          <strong className="text-teal-700">{places.length}곳</strong>
          {places.length > PAGE_SIZE && (
            <>
              {" "}
              중 {start + 1}–{start + pagePlaces.length}번째
            </>
          )}
        </span>
        {sigunguLabel && (
          <Link
            href={`/places${buildQuery({ ...currentParams, sigungu: undefined })}`}
            className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200"
          >
            {sigunguLabel} 필터 해제 ✕
          </Link>
        )}
      </p>

      {places.length === 0 ? (
        <div className="mt-6 rounded-2xl bg-white px-6 py-16 text-center ring-1 ring-slate-200">
          <p className="text-4xl" aria-hidden="true">
            🔎
          </p>
          <p className="mt-4 text-lg font-bold text-slate-800">
            검색 결과가 없어요
          </p>
          <p className="mt-1.5 text-sm text-slate-500">
            다른 검색어로 시도하거나, 아래 인기 관광지를 둘러보세요.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {["남이섬", "설악산", "경포"].map((name) => (
              <Link
                key={name}
                href={`/places${buildQuery({ q: name, profile: profileParam(profile) })}`}
                className="rounded-full bg-teal-50 px-4 py-1.5 text-sm font-semibold text-teal-700 transition-colors hover:bg-teal-100"
              >
                {name}
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {pagePlaces.map((place) => (
              <PlannerCard key={place.contentId} item={planItemOf(place)}>
                <PlaceCard
                  place={place}
                  profile={profile}
                  date={date}
                  end={end}
                  linkless={place.contentTypeId === 32}
                />
              </PlannerCard>
            ))}
          </div>

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <nav
              aria-label="페이지 이동"
              className="mt-8 flex items-center justify-center gap-4"
            >
              {page > 1 ? (
                <Link
                  href={pageHref(page - 1)}
                  className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-100"
                >
                  ← 이전
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className="rounded-full bg-slate-50 px-4 py-1.5 text-sm font-semibold text-slate-300 ring-1 ring-slate-100"
                >
                  ← 이전
                </span>
              )}
              <span className="text-sm font-semibold tabular-nums text-slate-600">
                {page} / {totalPages} 페이지
              </span>
              {page < totalPages ? (
                <Link
                  href={pageHref(page + 1)}
                  className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-100"
                >
                  다음 →
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className="rounded-full bg-slate-50 px-4 py-1.5 text-sm font-semibold text-slate-300 ring-1 ring-slate-100"
                >
                  다음 →
                </span>
              )}
            </nav>
          )}
        </>
      )}
    </>
  );
}

/** 결과 대기 중 폴백 — 카드 그리드 자리를 잡아 레이아웃 점프 없이 로딩을 보여준다 */
function ResultsSkeleton() {
  return (
    <div aria-hidden="true" className="animate-pulse">
      <div className="mt-6 h-4 w-56 rounded bg-slate-100" />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="h-44 rounded-2xl bg-white ring-1 ring-slate-100"
          />
        ))}
      </div>
    </div>
  );
}
