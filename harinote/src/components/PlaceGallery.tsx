"use client";

/**
 * 관광지 사진 갤러리 — detailImage2 실사진(originimgurl) 여러 장.
 * 서버가 URL 목록을 넘겨주면(images) 대표 1장 + 썸네일 스트립으로 표시하고,
 * 썸네일/대표 클릭 시 라이트박스로 확대한다. 이미지 로드 실패는 해당 장만 숨긴다.
 */
import { useState } from "react";
import Image from "next/image";
import type { PlaceEnvType } from "@/lib/tour/types";

const ENV_PLACEHOLDER: Record<PlaceEnvType, { emoji: string; bg: string }> = {
  indoor: { emoji: "🏛️", bg: "from-violet-100 to-indigo-200" },
  outdoor_water: { emoji: "🏞️", bg: "from-teal-100 to-cyan-200" },
  outdoor_mountain: { emoji: "⛰️", bg: "from-emerald-100 to-green-200" },
  outdoor_coast: { emoji: "🌊", bg: "from-sky-100 to-blue-200" },
  outdoor_general: { emoji: "🌳", bg: "from-lime-100 to-emerald-200" },
};

/**
 * 사진 틀 — 컨테이너 폭에 따라 비율이 달라야 한다.
 * wide: 전폭(1152px) 히어로. 3:2로 주면 768px까지 커져 화면을 잡아먹으므로 높이 고정.
 * half: 절반 컬럼(≈544px). 폭이 좁아 3:2를 줘도 363px이고, 원본 잘림이 10% 내외로 준다.
 * Tailwind v4는 소스를 스캔하므로 클래스는 반드시 리터럴로 둔다(문자열 조합 금지).
 */
const FRAME = {
  wide: { box: "h-64 sm:h-80", sizes: "(max-width: 1024px) 100vw, 1120px" },
  half: { box: "aspect-[3/2]", sizes: "(max-width: 1024px) 100vw, 560px" },
} as const;

interface Props {
  title: string;
  envType: PlaceEnvType;
  /** detailImage2 URL 목록 + 대표사진(imageUrl)을 서버에서 합쳐 중복 제거한 결과 */
  images: string[];
  /** 사진 틀 비율 — 전폭 히어로는 wide(기본), 2단 그리드의 절반 컬럼은 half */
  ratio?: keyof typeof FRAME;
}

export default function PlaceGallery({
  title,
  envType,
  images,
  ratio = "wide",
}: Props) {
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState(false);

  const frame = FRAME[ratio];
  const usable = images.filter((url) => !broken.has(url));

  // 사진이 하나도 없으면 환경 유형 플레이스홀더 (사진 있을 때와 같은 틀 — 레이아웃 시프트 방지)
  if (usable.length === 0) {
    const ph = ENV_PLACEHOLDER[envType];
    return (
      <div
        className={`flex w-full items-center justify-center rounded-2xl bg-gradient-to-br ${frame.box} ${ph.bg}`}
      >
        <span className="text-6xl" aria-hidden="true">
          {ph.emoji}
        </span>
      </div>
    );
  }

  const current = usable[Math.min(active, usable.length - 1)];
  const markBroken = (url: string) =>
    setBroken((prev) => new Set(prev).add(url));

  return (
    <>
      {/* min-w-0: 그리드/플렉스 자식이 되면 아래 썸네일 스트립(overflow-x-auto)이
          내부 스크롤 대신 컬럼을 밀어내 페이지가 가로로 넘친다 */}
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => setLightbox(true)}
          className={`relative block w-full overflow-hidden rounded-2xl ring-1 ring-slate-200 ${frame.box}`}
          aria-label={`${title} 사진 크게 보기`}
        >
          <Image
            src={current}
            alt={title}
            fill
            sizes={frame.sizes}
            onError={() => markBroken(current)}
            className="object-cover transition-transform duration-300 hover:scale-105"
          />
        </button>

        {usable.length > 1 && (
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {usable.map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={() => setActive(i)}
                aria-current={url === current ? "true" : undefined}
                className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg ring-2 transition-all ${
                  url === current
                    ? "ring-teal-500"
                    : "opacity-70 ring-transparent hover:opacity-100"
                }`}
              >
                <Image
                  src={url}
                  alt=""
                  fill
                  sizes="64px"
                  onError={() => markBroken(url)}
                  className="object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${title} 사진`}
          onClick={() => setLightbox(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          <button
            type="button"
            onClick={() => setLightbox(false)}
            aria-label="닫기"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-2xl text-white hover:bg-white/30"
          >
            ×
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current}
            alt={title}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      )}
    </>
  );
}
