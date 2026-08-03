/**
 * 숙박 상세 화면 — /places/[contentId]가 숙박(contentTypeId 32)일 때 렌더.
 *
 * 관광지 상세와 골격(히어로 2단 · 본문 좌 분석/우 행동)은 같게 두되, 숙소에
 * 맞지 않는 섹션(대체지 추천·반나절 코스·유아/반려동물·체크 리포트)은 빼고
 * 객실·가격과 기본정보를 넣었다. AI 3줄 요약은 관광지 985곳만 있어 제외.
 *
 * 정보 계층은 국내외 숙박 사이트(야놀자·여기어때·에어비앤비) 관례를 따랐다:
 * - 가격은 상단이 아니라 객실 섹션에서 처음 노출 (OTA 공통) — 그 자리엔 안전점수
 * - 데이터가 없어도 섹션을 숨기지 않고 "미제공 + 다음 행동"으로 자리를 채운다.
 *   숙소마다 페이지 구조가 달라지면 신뢰가 깨지고, TourAPI 숙박 상세는 결손이
 *   크다 (실측: 요금 40% · 기본정보 75% · 사진 58%)
 */
import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import {
  getDateSafety,
  getRangeSafety,
  type PlaceWithSafety,
} from "@/lib/datasource";
import { formatKoreanDate } from "@/lib/date";
import type { Profile } from "@/lib/safety/types";
import { PROFILE_LABEL } from "@/lib/safety/types";
import { CONTENT_TYPE_LABEL, ENV_TYPE_LABEL } from "@/lib/tour/types";
import {
  fetchLodgingIntro,
  fetchLodgingRooms,
  firstPhoneOf,
  priceRangeOf,
  type LodgingIntro,
  type LodgingRoom,
} from "@/lib/tour/lodging-detail";
import { GallerySection, OverviewSection, ReviewsSection } from "./sections";
import AddToPlanButton from "@/components/AddToPlanButton";
import PlaceGallery from "@/components/PlaceGallery";
import PlaceMap from "@/components/PlaceMap";
import ProfileChips from "@/components/ProfileChips";
import RangeDayStrip from "@/components/RangeDayStrip";
import RiskBreakdownBar from "@/components/RiskBreakdownBar";
import SafetyScoreBadge from "@/components/SafetyScoreBadge";
import { buildQuery, profileParam } from "@/components/search-params";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export default async function LodgingDetail({
  lodging,
  profile,
  date,
  end,
}: {
  lodging: PlaceWithSafety;
  profile: Profile;
  date?: string;
  end?: string;
}) {
  // 날짜·기간 점수는 관광지 상세와 동일한 규칙 (LodgingPlace가 SafetySpot을 만족)
  const rangeSafety =
    date && end ? await getRangeSafety(lodging, profile, date, end) : null;
  const dateSafety = rangeSafety
    ? rangeSafety.worst
    : date
      ? await getDateSafety(lodging, profile, date)
      : null;
  const activeDate = dateSafety ? date : undefined;
  const activeEnd = rangeSafety ? end : undefined;

  const safety = dateSafety ? dateSafety.breakdown : lodging.safety;
  // 분석 섹션은 계절 모드에서 궂은날 기준 — "무엇을 주의할지"가 목적
  const analysisSafety = dateSafety?.seasonal ? dateSafety.seasonal.bad : safety;

  const basePath = `/places/${lodging.contentId}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link
        href={`/places${buildQuery({ type: "lodging", profile: profileParam(profile), date, end })}`}
        className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 transition-colors hover:text-teal-700"
      >
        <span aria-hidden="true">←</span> 숙박 목록으로
      </Link>

      {/* ── 전폭 헤더: 뱃지·이름·주소 ── */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-700 ring-1 ring-teal-200">
          {CONTENT_TYPE_LABEL[32]}
        </span>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
          {ENV_TYPE_LABEL[lodging.envType]}
        </span>
      </div>
      <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
        {lodging.title}
      </h1>
      <p className="mt-1.5 text-sm text-slate-500 sm:text-base">{lodging.addr}</p>

      {/* ── 전폭 갤러리 ── */}
      <div className="mt-4">
        <Suspense
          fallback={
            <PlaceGallery
              title={lodging.title}
              envType={lodging.envType}
              images={lodging.imageUrl ? [lodging.imageUrl] : []}
            />
          }
        >
          <GallerySection
            contentId={lodging.contentId}
            title={lodging.title}
            envType={lodging.envType}
            imageUrl={lodging.imageUrl}
          />
        </Suspense>
      </div>

      {/* 본문 — 좌 숙소 정보 · 우 sticky 레일. 그리드 정의 근거는 page.tsx 주석 참고 */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        {/* 우 레일: 스크롤해도 따라오는 점수·담기·지도 */}
        <div className="order-1 min-w-0 space-y-6 lg:order-2 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
          <div>
            {dateSafety?.seasonal ? (
              /* 계절 모드: 개별 날짜 예보가 없어 단일 점수를 단정하지 않고 범위로 안내 */
              <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
                <p className="text-xs font-medium text-slate-500">
                  {rangeSafety
                    ? `기간 중 가장 주의가 필요한 날(${formatKoreanDate(dateSafety.dateISO)}) 기준 — `
                    : `${formatKoreanDate(dateSafety.dateISO)} 숙박 — `}
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
            {/* 감점 내역은 아래 요인별 막대가 전부 펼친다 (관광지 상세와 같은 원칙) */}
            {dateSafety?.mode === "forecast" && (
              <p className="mt-2 text-xs text-slate-400">
                기상은 {dateSafety.dayOffset}일 후 예보, 미세먼지·산불위험은
                현재값 기준입니다.
              </p>
            )}
            {rangeSafety && (
              <div className="mt-3">
                <RangeDayStrip
                  range={rangeSafety}
                  basePath={basePath}
                  extraParams={{ profile: profileParam(profile) }}
                />
              </div>
            )}

          </div>

          <div>
            <div className="flex flex-wrap gap-2">
              <AddToPlanButton
                item={{
                  contentId: lodging.contentId,
                  title: lodging.title,
                  lat: lodging.lat,
                  lng: lodging.lng,
                  score: safety.score,
                  kind: "lodging",
                }}
                contentTypeId={32}
              />
              <a
                href={`https://search.naver.com/search.naver?query=${encodeURIComponent(lodging.title)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-100"
              >
                <span aria-hidden="true">🔍</span> 네이버에서 예약·후기 보기
              </a>
              <a
                href={`https://map.kakao.com/link/to/${encodeURIComponent(lodging.title)},${lodging.lat},${lodging.lng}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-100"
              >
                <span aria-hidden="true">🧭</span> 길찾기 (실제 소요시간)
              </a>
            </div>
            {activeDate && (
              <p className="mt-3 text-xs font-semibold text-sky-700">
                {formatKoreanDate(activeDate)}
                {activeEnd ? ` ~ ${formatKoreanDate(activeEnd)}` : ""} 여행
                기준 점수예요
              </p>
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-slate-600">
              동행에 따라 점수가 달라져요 —{" "}
              <strong className="text-teal-700">
                {PROFILE_LABEL[profile]} 기준
              </strong>
            </p>
            <ProfileChips
              basePath={basePath}
              current={profile}
              extraParams={{ date: activeDate, end: activeEnd }}
            />
          </div>

          {/* 위치 지도 */}
          <section>
            <h2 className="text-lg font-bold text-slate-900">위치 보기</h2>
            <p className="mb-3 mt-1 text-sm text-slate-500">
              <span className="font-semibold text-teal-800">●</span> 숙소 위치
            </p>
            <PlaceMap
              target={{
                contentId: lodging.contentId,
                title: lodging.title,
                lat: lodging.lat,
                lng: lodging.lng,
                score: safety.score,
              }}
              alternatives={[]}
              profileQuery={buildQuery({
                profile: profileParam(profile),
                date: activeDate,
                end: activeEnd,
              })}
            />
          </section>
        </div>

        {/* 좌 본문: 고르는 데 필요한 순서 — 가격·객실 → 숙소 정보 → 소개 → 안전 분석 */}
        <div className="order-2 min-w-0 space-y-8 lg:order-1">
          <Suspense fallback={<SectionSkeleton label="객실·요금을 불러오는 중…" />}>
            <RoomsSection contentId={lodging.contentId} />
          </Suspense>

          <Suspense fallback={<SectionSkeleton label="숙소 정보를 불러오는 중…" />}>
            <IntroSection contentId={lodging.contentId} />
          </Suspense>

          <Suspense fallback={null}>
            <OverviewSection contentId={lodging.contentId} />
          </Suspense>
        </div>
      </div>

      {/* 안전 분석과 후기는 세로가 비슷해 나란히 두면 페이지가 절반으로 줄어든다
          (좁은 본문 컬럼에 직렬로 쌓으면 스크롤만 길어진다 — page.tsx와 같은 이유) */}
      <div className="mt-8 grid gap-8 lg:grid-cols-2 lg:items-start">
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

        {/* 방문 후기 (스트리밍, 후기 없으면 섹션 숨김) */}
        <Suspense fallback={null}>
          <ReviewsSection title={lodging.title} />
        </Suspense>
      </div>

      <p className="mt-8 text-xs leading-relaxed text-slate-400">
        객실·요금·시설 정보는 한국관광공사 TourAPI 등록 자료로, 실제와 다를 수
        있습니다. 예약 전 숙소에 직접 확인하세요. 안전 점수는 공공데이터 기반
        참고 정보이며 안전을 보장하지 않습니다.
      </p>
    </div>
  );
}

function SectionSkeleton({ label }: { label: string }) {
  return (
    <div
      aria-hidden="true"
      className="h-32 animate-pulse rounded-2xl bg-white ring-1 ring-slate-100"
    >
      <p className="p-4 text-sm text-slate-300">{label}</p>
    </div>
  );
}

/** 객실·요금 (detailInfo2) — 요금이 없어도 섹션을 숨기지 않는다 */
async function RoomsSection({ contentId }: { contentId: number }) {
  const [rooms, intro] = await Promise.all([
    fetchLodgingRooms(contentId),
    fetchLodgingIntro(contentId),
  ]);
  const range = priceRangeOf(rooms);
  const phone = firstPhoneOf(intro?.tel);

  return (
    <section>
      <h2 className="text-lg font-bold text-slate-900">객실 · 요금</h2>
      {range ? (
        <>
          <p className="mt-1 text-xl font-extrabold tabular-nums text-teal-700">
            1박 {won(range.min)}
            {range.max > range.min && ` ~ ${won(range.max)}`}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            등록된 객실 요금(비수기~성수기) 기준 · 실제 요금은 예약처·날짜에 따라
            달라요
          </p>
        </>
      ) : (
        <div className="mt-2 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <p className="text-sm font-semibold text-slate-700">
            등록된 요금 정보가 없어요
          </p>
          <p className="mt-1 text-sm text-slate-500">
            한국관광공사에 객실 요금이 올라와 있지 않은 숙소예요. 숙소에 직접
            확인해 주세요.
          </p>
          {phone && (
            <a
              href={`tel:${phone}`}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-teal-700 ring-1 ring-teal-200 transition-colors hover:bg-teal-50"
            >
              <span aria-hidden="true">📞</span> {phone}
            </a>
          )}
        </div>
      )}

      {rooms.length > 0 && (
        <ul className="mt-3 space-y-3">
          {rooms.map((room) => (
            <RoomCard key={room.title} room={room} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RoomCard({ room }: { room: LodgingRoom }) {
  const thumb = room.images[0];
  const fees: [string, number | undefined, number | undefined][] = [
    ["비수기", room.fees.offPeakWeekday, room.fees.offPeakWeekend],
    ["성수기", room.fees.peakWeekday, room.fees.peakWeekend],
  ];
  const hasFee = fees.some(([, a, b]) => a !== undefined || b !== undefined);

  return (
    <li className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
      <div className="flex gap-3 p-3">
        {thumb && (
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg">
            <Image
              src={thumb.url}
              alt={thumb.alt}
              fill
              sizes="96px"
              className="object-cover"
            />
            {room.images.length > 1 && (
              <span className="absolute bottom-1 right-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {room.images.length}장
              </span>
            )}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-slate-900">{room.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {[
              room.baseCount !== undefined && `기준 ${room.baseCount}인`,
              room.maxCount !== undefined && `최대 ${room.maxCount}인`,
              room.sizeM2 !== undefined && `${room.sizeM2}㎡`,
            ]
              .filter(Boolean)
              .join(" · ") || "인원 정보 미제공"}
          </p>

          {hasFee ? (
            <dl className="mt-2 space-y-0.5 text-xs">
              {fees.map(([label, weekday, weekend]) =>
                weekday === undefined && weekend === undefined ? null : (
                  <div key={label} className="flex gap-2">
                    <dt className="w-10 shrink-0 font-semibold text-slate-500">
                      {label}
                    </dt>
                    <dd className="tabular-nums text-slate-700">
                      {[
                        weekday !== undefined && `주중 ${won(weekday)}`,
                        weekend !== undefined && `주말 ${won(weekend)}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </dd>
                  </div>
                ),
              )}
            </dl>
          ) : (
            <p className="mt-2 text-xs text-slate-400">요금 미등록</p>
          )}

          {room.amenities.length > 0 && (
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              {room.amenities.join(" · ")}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

/** 기본정보 (detailIntro2) — 확인된 항목만 노출, 조건부 정보는 텍스트로 */
async function IntroSection({ contentId }: { contentId: number }) {
  const intro = await fetchLodgingIntro(contentId);

  return (
    <section>
      <h2 className="text-lg font-bold text-slate-900">숙소 기본정보</h2>
      {intro ? (
        <div className="mt-2 rounded-xl bg-white p-4 ring-1 ring-slate-200">
          <IntroFacts intro={intro} />
          {intro.facilities.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
              {intro.facilities.map((f) => (
                <span
                  key={f}
                  className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-700 ring-1 ring-teal-200"
                >
                  {f}
                </span>
              ))}
            </div>
          )}
          {intro.refundPolicy && (
            <details className="group mt-3 border-t border-slate-100 pt-3">
              <summary className="cursor-pointer list-none text-sm font-semibold text-slate-700 transition-colors hover:text-teal-700">
                <span className="mr-1 inline-block transition-transform group-open:rotate-90">
                  ▸
                </span>
                환불 규정 보기
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {intro.refundPolicy}
              </p>
            </details>
          )}
          <p className="mt-3 text-xs text-slate-400">
            한국관광공사 제공 · 예약 전 숙소에 확인을 권장해요.
          </p>
        </div>
      ) : (
        <p className="mt-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-500 ring-1 ring-slate-200">
          체크인·주차 등 상세 정보가 등록되지 않은 숙소예요. 네이버 검색이나
          숙소 문의로 확인해 주세요.
        </p>
      )}
    </section>
  );
}

function IntroFacts({ intro }: { intro: LodgingIntro }) {
  const checkTime =
    intro.checkIn || intro.checkOut
      ? [
          intro.checkIn && `입실 ${intro.checkIn}`,
          intro.checkOut && `퇴실 ${intro.checkOut}`,
        ]
          .filter(Boolean)
          .join(" · ")
      : undefined;
  const roomInfo =
    intro.roomCount || intro.roomType
      ? [intro.roomCount && `${intro.roomCount}실`, intro.roomType]
          .filter(Boolean)
          .join(" · ")
      : undefined;

  const facts: [string, string | undefined][] = [
    ["체크인", checkTime],
    ["객실", roomInfo],
    ["주차", intro.parking],
    ["취사", intro.cooking],
    ["부대시설", intro.subFacility],
    ["식음료장", intro.foodPlace],
    ["예약", intro.reservation],
    ["규모", intro.scale],
    ["문의", intro.tel],
  ].filter(([, v]) => v !== undefined) as [string, string][];

  if (facts.length === 0) return null;

  return (
    <dl className="space-y-1.5 text-sm">
      {facts.map(([label, value]) => (
        <div key={label} className="flex gap-3">
          <dt className="w-16 shrink-0 font-semibold text-slate-500">{label}</dt>
          <dd className="min-w-0 flex-1 leading-relaxed text-slate-700">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
