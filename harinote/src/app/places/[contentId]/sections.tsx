/**
 * 상세 페이지의 외부 API 의존 섹션 — Suspense로 스트리밍해 페이지 본문을 블로킹하지 않는다.
 * - GallerySection: detailImage2 추가 사진 조회 (fallback은 대표사진만으로 즉시 렌더)
 * - ReviewsSection: 네이버 블로그 후기 조회 (fallback은 없음 — 준비되면 나타남)
 * TourAPI 게이트웨이가 느려도(초 단위 편차) 점수·대체지 등 본문은 즉시 뜬다.
 */
import type { PlaceEnvType } from "@/lib/tour/types";
import { fetchPlaceImages } from "@/lib/tour/images";
import { fetchPlaceOverview } from "@/lib/tour/overview";
import { fetchPlacePetInfo } from "@/lib/tour/pet";
import { fetchBlogReviews } from "@/lib/review/naver-blog";
import PlaceGallery from "@/components/PlaceGallery";
import BlogReviews from "@/components/BlogReviews";

/** 대표사진(imageUrl) + detailImage2 실사진을 합치고 중복 제거 — 대표사진 우선 */
export async function GallerySection({
  contentId,
  title,
  envType,
  imageUrl,
  ratio,
}: {
  contentId: number;
  title: string;
  envType: PlaceEnvType;
  imageUrl?: string;
  /** 사진 틀 비율 — 전폭 히어로(숙박)는 생략, 절반 컬럼(관광지 상세)은 "half" */
  ratio?: "wide" | "half";
}) {
  const detailImages = await fetchPlaceImages(contentId);
  const images = [
    ...(imageUrl ? [imageUrl] : []),
    ...detailImages.filter((url) => url !== imageUrl),
  ];
  return (
    <PlaceGallery
      title={title}
      envType={envType}
      images={images}
      ratio={ratio}
    />
  );
}

/** TourAPI detailCommon2 소개문 — 실시간 조회(24h 캐시), 없으면 섹션 숨김 */
export async function OverviewSection({
  contentId,
  fallback,
}: {
  contentId: number;
  /** 내장 데이터에 소개문이 있으면 조회 실패 시 폴백 */
  fallback?: string;
}) {
  const overview = (await fetchPlaceOverview(contentId)) ?? fallback;
  if (!overview) return null;
  // 3줄 요약은 히어로(이름·주소 아래)에서 보여주므로, 여기서는 원문을 접어둔다
  return (
    <section>
      <details className="group rounded-xl bg-white ring-1 ring-slate-200">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:text-teal-700">
          <span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>
          전체 소개 보기
          <span className="ml-2 text-xs font-normal text-slate-400">한국관광공사 제공</span>
        </summary>
        <p className="border-t border-slate-100 px-4 py-3 text-sm leading-relaxed text-slate-600">
          {overview}
        </p>
      </details>
    </section>
  );
}

/** TourAPI detailPetTour2 반려동물 동반 정보 — 실시간 조회, 정보 없으면 숨김 */
export async function PetSection({ contentId }: { contentId: number }) {
  const pet = await fetchPlacePetInfo(contentId);
  if (!pet) return null;
  return (
    <section>
      <h2 className="text-lg font-bold text-slate-900">
        🐶 반려동물과 함께
      </h2>
      <dl className="mt-2 space-y-1.5 rounded-xl bg-white p-4 text-sm leading-relaxed text-slate-600 ring-1 ring-slate-200">
        {pet.allowed && (
          <div>
            <dt className="inline font-semibold text-slate-700">동반 가능: </dt>
            <dd className="inline">{pet.allowed}</dd>
          </div>
        )}
        {pet.type && (
          <div>
            <dt className="inline font-semibold text-slate-700">동반 유형: </dt>
            <dd className="inline">{pet.type}</dd>
          </div>
        )}
        {pet.needs && (
          <div>
            <dt className="inline font-semibold text-slate-700">준비물·조건: </dt>
            <dd className="inline">{pet.needs}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

export async function ReviewsSection({ title }: { title: string }) {
  const reviews = await fetchBlogReviews(title);
  if (reviews.length === 0) return null;
  // 마진은 부모 컬럼의 space-y가 담당한다 — 여기서 mt를 주면 옆 컬럼과 상단이 어긋난다
  return (
    <section>
      <h2 className="text-lg font-bold text-slate-900">방문 후기</h2>
      {/* 장소 이름은 h1에, "누르면 원문으로 이동"은 링크 카드에 자명하다 — 출처만 밝힌다 */}
      <p className="mt-1 text-sm text-slate-500">네이버 블로그 검색 결과예요</p>
      <BlogReviews reviews={reviews} />
    </section>
  );
}
