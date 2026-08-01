/** 관광지 상세 로딩 스켈레톤 — 서버 렌더 대기 중 즉시 표시해 전환 체감 속도 개선 */
export default function PlaceDetailLoading() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse px-4 py-8">
      <div className="h-4 w-32 rounded bg-slate-100" />
      {/* 전폭 헤더 */}
      <div className="mt-4 h-5 w-32 rounded-full bg-slate-100" />
      <div className="mt-2 h-8 w-72 rounded-lg bg-slate-200" />
      <div className="mt-3 h-5 w-52 rounded-full bg-slate-100" />
      {/* 전폭 액션 버튼 */}
      <div className="mt-4 h-8 w-64 rounded-full bg-slate-100" />
      {/* 상단 — 좌 사진(3:2) · 우 요약·소개·지도 (실제 페이지와 같은 트랙) */}
      <div className="mt-6 grid gap-8 lg:grid-cols-2 lg:items-start">
        <div className="aspect-[3/2] rounded-2xl bg-white ring-1 ring-slate-100" />
        <div className="h-[34rem] rounded-2xl bg-white ring-1 ring-slate-100" />
      </div>
    </div>
  );
}
