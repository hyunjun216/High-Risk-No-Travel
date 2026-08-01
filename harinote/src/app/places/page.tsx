import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  getPlaces,
  getPlacesWithSafety,
  getPlacesWithSafetyOnDate,
  getPlacesWithSafetyOnRange,
  matchesPlaceQuery,
  type PlaceWithSafety,
} from "@/lib/datasource";
import { getLodgings } from "@/lib/tour/lodging";
import {
  searchLodgings,
  searchPlaces,
  suggestLodgingQuery,
  suggestPlaceQuery,
} from "@/lib/search/places";
import type { Profile } from "@/lib/safety/types";
import type { PlanDragPayload } from "@/lib/travel-plan";
import { dayOffsetSeoul, formatKoreanDate, todayISOSeoul } from "@/lib/date";
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
import {
  savedDate,
  savedEnd,
  savedProfile,
  savedTransport,
} from "@/lib/prefs";
import SearchBox from "@/components/SearchBox";
import TravelFilterPanel from "@/components/TravelFilterPanel";
import {
  buildQuery,
  first,
  pageWindow,
  parseDateRange,
  parsePage,
  parsePet,
  parsePlaceType,
  parseProfile,
  parseSigunguList,
  parseSort,
  parseTransport,
  placeTypeToQuery,
  profileParam,
  sigunguParam,
  sigunguSummaryLabel,
  sortParam,
  type PlaceTypeParam,
  type SearchParamValue,
} from "@/components/search-params";
import SortDropdown from "@/components/SortDropdown";
import { sortPlaces, type SortKey } from "@/lib/places-sort";
import { getLodgingsWithSafety } from "@/lib/tour/lodging-safety";
import { isPetFriendly } from "@/lib/tour/pet-friendly";

const PAGE_SIZE = 24;

export const metadata: Metadata = {
  title: "여행 계획",
};

const TYPE_TABS: { label: string; value?: PlaceTypeParam }[] = [
  { label: "전체" },
  ...SUPPORTED_CONTENT_TYPE_IDS.map((id) => ({
    label: CONTENT_TYPE_LABEL[id],
    value: id as PlaceTypeParam,
  })),
  // 카페는 음식점(39) 소분류지만 별도 탭 — 음식점 탭에서는 제외해 완전히 분리한다
  // (placeTypeToQuery: 39 → excludeCat3, "cafe" → cat3)
  { label: CAT3_CAFE_LABEL, value: "cafe" },
  // 숙박은 별도 내장 데이터셋(lodging.gangwon.json) — 전체 탭에도 함께 노출된다
  { label: CONTENT_TYPE_LABEL[32], value: "lodging" },
];

/**
 * 탭 라벨 옆 건수 — 유형을 고르기 전에 규모를 알 수 있게 한다(문화시설 109곳 등).
 * 시군·날짜·검색 필터는 반영하지 않는 데이터 원본 건수다. 실시간 건수는 전량 점수
 * 조회를 기다려야 해서 셸 즉시 렌더(아래 Suspense 주석)를 깨뜨린다.
 * 결과 목록과 같은 술어(matchesPlaceQuery)로 세므로 탭 정의와 어긋날 수 없다.
 * 다만 숙박은 점수를 못 만든 곳이 목록에서 빠질 수 있어 실제보다 클 수 있다.
 */
async function typeTabCounts(): Promise<Map<PlaceTypeParam | undefined, number>> {
  const pool = [...(await getPlaces()), ...getLodgings()];
  return new Map(
    TYPE_TABS.map((tab) => [
      tab.value,
      tab.value === undefined
        ? pool.length
        : pool.filter((p) => matchesPlaceQuery(p, placeTypeToQuery(tab.value)))
            .length,
    ]),
  );
}

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
    // 숙박은 계획 패널·리포트가 kind로 분기 (숙소 슬롯 표시)
    ...(place.contentTypeId === 32 ? { kind: "lodging" as const } : {}),
  };
}

export default async function PlacesPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = first(sp.q)?.trim() ?? "";
  const placeType = parsePlaceType(sp.type);
  // URL 파라미터 우선, 없으면 쿠키에 기억된 조건 (홈·상세와 동일 규칙)
  const profile =
    sp.profile !== undefined
      ? parseProfile(sp.profile)
      : ((await savedProfile()) ?? "default");
  const sigunguCodes = parseSigunguList(sp.sigungu);
  const sigunguLabel =
    sigunguCodes.length > 0 ? sigunguSummaryLabel(sigunguCodes) : undefined;
  // 여행 조건 패널 열림 유지 플래그 — 패널 내부 링크에만 실린다 (currentParams에 넣지 말 것)
  const filtersOpen = first(sp.fo) === "1";

  // 날짜·기간 모드 (홈 날짜 스테퍼에서 전달, 기간은 URL 직접 지정)
  // 단일: 그날 기준 점수 / 기간: 기간 중 최악일 대표점수로 목록 구성
  // URL 파라미터 우선, 없으면 기억된 날짜 — 헤더 검색·탭 이동처럼 date가 빠지는
  // 경로에서도 고른 날짜가 유지된다. 해제는 날짜 해제 칩(명시적으로 오늘을 실어 보냄).
  //
  // 날짜와 기간은 반드시 **한 출처**에서 가져온다. 섞으면 `?date=`만 있는 단일 날짜 요청에
  // 남아 있던 hari_end가 붙어, 사용자가 요청하지 않은 기간 모드(기간 중 최악일 대표점수)로
  // 목록 전체가 계산된다.
  const dateFromUrl = sp.date !== undefined;
  const { start: date, end } = parseDateRange(
    dateFromUrl ? sp.date : await savedDate(),
    dateFromUrl ? sp.end : await savedEnd(),
  );
  // 반려동물 동반 필터 (TourAPI detailPetTour2 수집분)
  const pet = parsePet(sp.pet);
  const petParam = pet ? "1" : undefined;
  // 이동 수단 (상세의 대체지·코스 반경에 반영) — URL 우선, 없으면 쿠키 기억값
  const transport =
    parseTransport(sp.tr) ?? (await savedTransport()) ?? "transit";
  const page = parsePage(sp.page);
  const sort = parseSort(sp.sort, !!q);
  // 탭 건수는 원본 데이터 로드만 필요 — 전량 점수 계산(결과 영역)과 달리 셸을 붙잡지 않는다
  const tabCounts = await typeTabCounts();

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
    sort: sortParam(sort, !!q),
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
    sort,
  ].join("|");

  return (
    // 모바일: flex-col + order로 검색 결과가 인기 TOP10보다 먼저 (블록 레이아웃에선 order가 무시됨)
    <div className="mx-auto flex max-w-[84rem] flex-col px-4 py-8 lg:grid lg:grid-cols-[240px_minmax(0,1fr)_380px] lg:items-start lg:gap-6">
      {/* 좌: 인기 관광지 (lg에서 왼쪽 sticky, 모바일은 본문 아래) */}
      <div className="order-2 mt-10 lg:order-1 lg:mt-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
        <PopularSidebar profile={profile} />
      </div>

      <div className="order-1 lg:order-2">
        {/* 화면 목적 — 탭 라벨(4자)이 못 담는 "찾아서 담는 곳"을 여기서 설명 */}
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
          여행 계획 세우기
        </h1>
        <p className="mt-2 mb-5 text-sm text-slate-500 sm:text-base">
          갈 곳을 찾아 안전 점수를 확인하고, 일정표에 담아 하루를 완성하세요.
        </p>

        {/* 이 화면의 검색창 — 전 폭에서 노출한다. 헤더 전역 검색은 여행 조건을 실을 수
            없어 /places에서는 감춰지므로(HeaderSearch), 여기가 유일한 검색 입구다. */}
        <div className="max-w-2xl">
          <SearchBox
            defaultQuery={q}
            profile={profile}
            date={date}
            end={end}
            sigungu={sigunguParam(sigunguCodes)}
            placeType={placeType}
            pet={petParam}
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
          aria-label="장소 종류 필터"
          className="flex flex-wrap gap-2 border-t border-slate-100 pt-3"
        >
          {TYPE_TABS.map((tab) => {
            const active = tab.value === placeType;
            const href = `/places${buildQuery({ ...currentParams, type: tab.value })}`;
            const count = tabCounts.get(tab.value);
            return (
              <Link
                key={tab.label}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-baseline gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                }`}
              >
                {tab.label}
                {count !== undefined && (
                  <span
                    className={`text-[11px] font-bold tabular-nums ${
                      active ? "text-white/60" : "text-slate-400"
                    }`}
                  >
                    {count.toLocaleString("ko-KR")}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* 날짜를 명시한 진입(날짜 해제 칩·공유 링크)만 기억을 갱신한다 — 아래 주석의 규칙은
          홈·상세와 동일하다 (undefined = 손대지 않음, null = 지움) */}
      <PrefsPersist
        profile={profile}
        transport={transport}
        date={sp.date !== undefined ? (date ?? null) : undefined}
        end={sp.date !== undefined ? (end ?? null) : undefined}
      />

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
          sort={sort}
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
  sort,
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
  sort: SortKey;
  currentParams: Record<string, string | number | undefined>;
}) {
  // 기본 정렬 = 안전점수 높은 순 — "어디가 안전한가"가 서비스의 축이므로
  // 데이터 순서(사실상 가나다)가 아니라 점수가 목록의 기준이어야 한다.
  // 정확도순·인기순은 places-sort.ts. 전량 점수는 10분 메모리 캐시를 재사용해 부담 없음.
  const tourPlaces = () =>
    date
      ? end
        ? getPlacesWithSafetyOnRange(profile, date, end)
        : getPlacesWithSafetyOnDate(profile, date)
      : getPlacesWithSafety(undefined, profile);
  // 숙박은 별도 내장 데이터셋 — 전체 탭에서는 관광지와 합쳐 한 목록으로 본다
  // (계획을 세우는 화면이므로 잘 곳도 같은 목록에서 찾아야 한다). 유형 탭을 고르면
  // 해당 데이터셋만 로드한다. 이후 필터·정렬·페이지네이션은 동일 경로를 탄다.
  const all =
    placeType === "lodging"
      ? await getLodgingsWithSafety(profile, date, end)
      : placeType === undefined
        ? (
            await Promise.all([
              tourPlaces(),
              getLodgingsWithSafety(profile, date, end),
            ])
          ).flat()
        : await tourPlaces();
  // 검색은 색인 전체를 한 번에 봐야 점수(IDF·랭킹)가 나오므로 항목별 술어로 만들 수 없다.
  // 그래서 먼저 검색해 contentId→점수 맵을 얻고, 그 맵으로 거른 뒤 나머지 필터를 얹는다.
  // 전체 탭은 두 색인의 결과를 합친다 — 색인이 달라 BM25 점수 척도가 완전히 같지는
  // 않지만(정확도순에서 두 데이터셋이 섞인다), 숙소가 검색에서 아예 빠지는 것보다 낫다.
  const relevance = q
    ? new Map(
        (placeType === "lodging"
          ? searchLodgings(q)
          : placeType === undefined
            ? [...(await searchPlaces(q)), ...searchLodgings(q)]
            : await searchPlaces(q)
        ).map((h) => [h.contentId, h.score]),
      )
    : undefined;
  const filtered = all
    .filter((p) => !relevance || relevance.has(p.contentId))
    .filter((p) => matchesPlaceQuery(p, placeTypeToQuery(placeType)))
    // 시군 복수선택 — PlaceQuery는 단일값 계약이라 pet/kids처럼 후필터
    .filter(
      (p) =>
        sigunguCodes.length === 0 ||
        (p.sigunguCode !== undefined && sigunguCodes.includes(p.sigunguCode)),
    )
    .filter((p) => !pet || isPetFriendly(p.contentId));
  const places = sortPlaces(filtered, sort, relevance);

  // 오타 제안은 0건일 때만 — 항상 켜면 멀쩡한 검색어까지 멋대로 바꾼다 (suggest.ts)
  // 전체 탭은 관광지 색인에서 못 찾으면 숙박 색인에도 물어본다 (목록과 같은 범위)
  const suggestion =
    q && places.length === 0
      ? placeType === "lodging"
        ? suggestLodgingQuery(q)
        : placeType === undefined
          ? ((await suggestPlaceQuery(q)) ?? suggestLodgingQuery(q))
          : await suggestPlaceQuery(q)
      : null;

  // 목록 대상 명사 — 전체 탭은 숙박까지 포함하므로 "관광지"로 좁혀 말하지 않는다
  const poolNoun =
    placeType === undefined ? "여행지" : placeType === "lodging" ? "숙소" : "관광지";

  // 서버 사이드 페이지네이션 — 24건/페이지.
  const totalPages = Math.max(1, Math.ceil(places.length / PAGE_SIZE));
  const page = Math.min(pageParam, totalPages);
  const start = (page - 1) * PAGE_SIZE;
  const pagePlaces = places.slice(start, start + PAGE_SIZE);

  const pageHref = (p: number) =>
    `/places${buildQuery({ ...currentParams, page: p === 1 ? undefined : p })}`;

  return (
    <>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-2">
      <p className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
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
            `${poolNoun} `
          ) : (
            `강원 ${poolNoun} `
          )}
          <strong className="text-teal-700">{places.length}곳</strong>
          {places.length > PAGE_SIZE && (
            <>
              {" "}
              중 {start + 1}–{start + pagePlaces.length}번째
            </>
          )}
        </span>
        {/* 날짜 해제 — 오늘을 명시해 보낸다. date를 생략하면 기억된 날짜가 폴백돼
            해제가 되지 않는다 (TravelFilterPanel의 tr 명시 초기화와 같은 이유).
            parseDate가 오늘을 거부하므로 결과는 오늘 모드이고, PrefsPersist가 기억도 지운다. */}
        {date && (
          <Link
            href={`/places${buildQuery({ ...currentParams, date: todayISOSeoul(), end: undefined })}`}
            className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200"
          >
            날짜 해제 ✕
          </Link>
        )}
        {/* 검색어 해제 — 헤더 검색창은 layout 소속이라 searchParams를 못 읽어 늘 빈칸이다.
            이 링크가 없으면 검색어를 되돌릴 수단이 화면에서 사라진다 (라벨은 시군과 달리
            길이가 무제한인 사용자 입력이라 본문에만 싣고 칩에는 반복하지 않는다). */}
        {q && (
          <Link
            href={`/places${buildQuery({ ...currentParams, q: undefined })}`}
            className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200"
          >
            검색어 해제 ✕
          </Link>
        )}
        {sigunguLabel && (
          <Link
            href={`/places${buildQuery({ ...currentParams, sigungu: undefined })}`}
            className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200"
          >
            {sigunguLabel} 필터 해제 ✕
          </Link>
        )}
      </p>
      {places.length > 0 && (
        <SortDropdown sort={sort} hasQuery={!!q} currentParams={currentParams} />
      )}
      </div>

      {places.length === 0 ? (
        <div className="mt-6 rounded-2xl bg-white px-6 py-16 text-center ring-1 ring-slate-200">
          <p className="text-4xl" aria-hidden="true">
            🔎
          </p>
          <p className="mt-4 text-lg font-bold text-slate-800">
            검색 결과가 없어요
          </p>
          {suggestion ? (
            <p className="mt-1.5 text-sm text-slate-500">
              혹시{" "}
              <Link
                href={`/places${buildQuery({ ...currentParams, q: suggestion, page: undefined })}`}
                className="font-bold text-teal-700 underline underline-offset-2 hover:text-teal-800"
              >
                {suggestion}
              </Link>
              을(를) 찾으셨나요?
            </p>
          ) : (
            <p className="mt-1.5 text-sm text-slate-500">
              다른 검색어로 시도하거나, 아래 인기 관광지를 둘러보세요.
            </p>
          )}
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
                />
              </PlannerCard>
            ))}
          </div>

          {/* 페이지네이션 — 현재 페이지 중심 숫자 창(pageWindow) + 이전/다음 */}
          {totalPages > 1 && (
            <nav
              aria-label="페이지 이동"
              className="mt-8 flex items-center justify-center gap-1.5"
            >
              {page > 1 ? (
                <Link
                  href={pageHref(page - 1)}
                  aria-label="이전 페이지"
                  className="mr-2 grid h-9 w-9 place-items-center rounded-lg bg-white text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-100"
                >
                  ‹
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className="mr-2 grid h-9 w-9 place-items-center rounded-lg bg-slate-50 text-slate-300 ring-1 ring-slate-100"
                >
                  ‹
                </span>
              )}
              {pageWindow(page, totalPages).map((n) =>
                n === page ? (
                  <span
                    key={n}
                    aria-current="page"
                    className="grid h-9 w-9 place-items-center rounded-full bg-teal-600 text-sm font-bold tabular-nums text-white"
                  >
                    {n}
                  </span>
                ) : (
                  <Link
                    key={n}
                    href={pageHref(n)}
                    className="grid h-9 w-9 place-items-center rounded-full text-sm font-semibold tabular-nums text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  >
                    {n}
                  </Link>
                ),
              )}
              {page < totalPages ? (
                <Link
                  href={pageHref(page + 1)}
                  aria-label="다음 페이지"
                  className="ml-2 grid h-9 w-9 place-items-center rounded-lg bg-white text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-100"
                >
                  ›
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className="ml-2 grid h-9 w-9 place-items-center rounded-lg bg-slate-50 text-slate-300 ring-1 ring-slate-100"
                >
                  ›
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
