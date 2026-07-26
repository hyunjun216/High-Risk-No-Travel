/**
 * 캐시 워밍 라우트 — Vercel Cron이 주기적으로 호출해 기상청 149격자·AirKorea·
 * 산불 캐시를 미리 채운다 (vercel.json crons 참고).
 *
 * 홈이 SSR로 getRegionSummaries를 기다리는 구조라, 콜드 인스턴스의 첫 방문자는
 * 격자 수집 ~20초를 그대로 맞는다. 이 라우트가 그 20초를 대신 맞아 사용자 요청은
 * 항상 웜 캐시를 타게 한다. 워밍의 실체는 kma.ts·airkorea.ts fetch의
 * next.revalidate(Data Cache) — 모듈 메모리 캐시는 라우트별 번들에 격리돼
 * 여기서 데워도 홈에 안 닿지만, Data Cache는 라우트·인스턴스 공유라 닿는다.
 * 크론 시각(:15)은 기상청 발표 반영(매 3시간 hh:10) 직후를 노린 것.
 *
 * 인증: CRON_SECRET 환경변수가 있으면 Vercel Cron의 `Authorization: Bearer` 헤더와
 * 대조한다 (외부 남발 호출로 공공 API 쿼터가 새는 것 방지). 없으면 개방 — 로컬 개발용.
 */
import { getRegionSummaries } from "@/lib/risk/region-summary";

/** 콜드 워밍 실측 ~20초 + 여유. Vercel 기본 함수 제한(10초)을 넘겨야 한다 */
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    // 오늘 기준 1회면 충분 — KMA 캐시는 격자 단위(응답에 오늘~D+3 전체 포함)라
    // 홈 날짜 스테퍼(오늘~D+3)의 모든 날짜가 같은 캐시를 탄다. 프로필도 API 무관.
    const regions = await getRegionSummaries("default");
    return Response.json({
      warmed: regions.length,
      tookMs: Date.now() - startedAt,
    });
  } catch (error) {
    return Response.json(
      {
        error: `워밍 실패: ${error instanceof Error ? error.message : String(error)}`,
        tookMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}
