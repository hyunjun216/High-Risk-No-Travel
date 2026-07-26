/**
 * AirKorea 시도별 실시간 측정정보(getCtprvnRltmMesureDnsty) 클라이언트.
 *
 * 계약: getGangwonPm25(sigunguCode?) — 해당 시군 대표 측정소의 PM2.5(㎍/㎥).
 * 강원 전체를 1회 호출해 1시간 캐시하고, 측정소별 값을 시군에 매핑한다.
 * 결측("-"·통신장애)이면 인접 시군 측정소 → 강원 전체 유효값 평균 순으로 폴백.
 * 서버 전용 — AIRKOREA_API_KEY는 클라이언트 번들에 노출 금지.
 */
import { z } from "zod";
import { createTtlCache } from "./cache";

const BASE_URL =
  "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty";

/**
 * 시군 → AirKorea 측정소명(우선순위) 매핑.
 * 측정소명은 읍면동 단위(예: 춘천 → "중앙로")라 시군명과 다르다.
 * 명단은 2026-07 check-risk-apis.ts 실호출 응답(강원 39곳)으로 검증했다.
 * 도심 상시측정소를 우선하고 항만·DMZ 특수측정소는 후순위 후보로 둔다.
 * 명단 변경으로 이름이 안 맞게 되는 시군은 폴백 체인과 평균으로 흡수된다.
 */
export const SIGUNGU_STATIONS: Record<number, string[]> = {
  1: ["옥천동", "주문진읍", "초당동", "옥계항"], // 강릉
  2: ["간성읍", "고성(DMZ)"], // 고성
  3: ["천곡동", "동해항", "묵호항"], // 동해
  4: ["남양동1", "삼척항", "호산항"], // 삼척
  5: ["금호동"], // 속초
  6: ["양구읍", "방산면"], // 양구
  7: ["양양읍"], // 양양
  8: ["영월읍"], // 영월
  9: ["중앙동(강원)", "문막읍", "지정면", "치악산"], // 원주
  10: ["인제읍", "인제(DMZ)"], // 인제
  11: ["정선읍", "북평면"], // 정선
  12: ["갈말읍", "철원(DMZ)"], // 철원
  13: ["중앙로", "퇴계동", "신사우동"], // 춘천
  14: ["황지동"], // 태백
  15: ["평창읍"], // 평창
  16: ["홍천읍"], // 홍천
  17: ["화천읍", "화천(DMZ)"], // 화천
  18: ["횡성읍", "우천면"], // 횡성
};

/** 측정소가 없거나 결측인 시군의 인접 시군 폴백 (지리 인접 기준) */
export const SIGUNGU_STATION_FALLBACK: Record<number, number> = {
  1: 3, // 강릉 → 동해
  2: 5, // 고성 → 속초
  3: 1, // 동해 → 강릉
  4: 3, // 삼척 → 동해
  5: 7, // 속초 → 양양
  6: 13, // 양구 → 춘천
  7: 5, // 양양 → 속초
  8: 14, // 영월 → 태백
  9: 18, // 원주 → 횡성
  10: 16, // 인제 → 홍천
  11: 14, // 정선 → 태백
  12: 17, // 철원 → 화천
  13: 16, // 춘천 → 홍천
  14: 4, // 태백 → 삼척
  15: 1, // 평창 → 강릉(대관령권)
  16: 13, // 홍천 → 춘천
  17: 13, // 화천 → 춘천
  18: 9, // 횡성 → 원주
};

const airkoreaResponseSchema = z.object({
  response: z.object({
    header: z.object({
      resultCode: z.string(),
      resultMsg: z.string().optional(),
    }),
    body: z
      .object({
        items: z.array(
          z.object({
            stationName: z.string(),
            pm25Value: z.string().nullable().optional(),
            pm25Flag: z.string().nullable().optional(),
          }),
        ),
      })
      .optional(),
  }),
});

function requireApiKey(): string {
  const key = process.env.AIRKOREA_API_KEY;
  if (!key) {
    throw new Error(
      "AIRKOREA_API_KEY가 설정되지 않았습니다. .env.local에 data.go.kr '일반 인증키(Decoding)' 값을 넣어주세요.",
    );
  }
  return key;
}

/** 측정소명 → 유효 PM2.5 값 맵. 결측("-"·null·통신장애 플래그)은 제외 */
export type StationPm25Map = Map<string, number>;

/** 원시 호출 — 강원 전체 측정소 1회 조회. 스모크 스크립트에서도 사용 */
export async function fetchGangwonStationPm25Raw(): Promise<StationPm25Map> {
  const key = requireApiKey();
  const params = new URLSearchParams({
    serviceKey: key,
    returnType: "json",
    sidoName: "강원",
    ver: "1.0",
    numOfRows: "100",
    pageNo: "1",
  });

  // 타임아웃 — kma.ts와 동일한 이유 (무응답 API가 렌더를 붙잡지 않도록)
  // next.revalidate — kma.ts와 동일: 라우트 간 공유 Data Cache로 크론 워밍이 닿게
  const res = await fetch(`${BASE_URL}?${params.toString()}`, {
    signal: AbortSignal.timeout(5000),
    next: { revalidate: 60 * 60 },
  });
  const text = await res.text();

  if (text.trimStart().startsWith("<")) {
    const authMsg = /<returnAuthMsg>([^<]*)<\/returnAuthMsg>/.exec(text)?.[1];
    const reasonCode = /<returnReasonCode>([^<]*)<\/returnReasonCode>/.exec(text)?.[1];
    throw new Error(
      `AirKorea API가 XML 오류를 반환했습니다: ${authMsg ?? "원인 불명"} (returnReasonCode=${reasonCode ?? "?"})`,
    );
  }
  if (!res.ok) {
    throw new Error(
      `AirKorea API 호출 실패: HTTP ${res.status} ${text.trim().slice(0, 100)}`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`AirKorea API 응답이 JSON이 아닙니다: ${text.trim().slice(0, 100)}`);
  }

  const parsed = airkoreaResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `AirKorea API 응답이 예상 스키마와 다릅니다: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }

  const { resultCode, resultMsg } = parsed.data.response.header;
  if (resultCode !== "00") {
    throw new Error(
      `AirKorea API 오류 응답: resultCode=${resultCode}, resultMsg=${resultMsg ?? "메시지 없음"}`,
    );
  }

  const map: StationPm25Map = new Map();
  for (const item of parsed.data.response.body?.items ?? []) {
    // pm25Flag가 있으면(점검및교정·통신장애 등) 결측 취급
    if (item.pm25Flag) continue;
    const value = Number(item.pm25Value);
    if (item.pm25Value == null || item.pm25Value === "-" || !Number.isFinite(value)) {
      continue;
    }
    if (value < 0) continue;
    map.set(item.stationName, value);
  }
  return map;
}

/** 시도 단위 1회 호출 1시간 캐시 (실패는 5분 후 재시도) */
const cache = createTtlCache<StationPm25Map>(60 * 60 * 1000, 5 * 60 * 1000);

function fetchGangwonStationPm25(): Promise<StationPm25Map> {
  return cache.get("gangwon", fetchGangwonStationPm25Raw);
}

/** 측정소 맵에서 시군의 PM2.5 선택 (순수 함수 — 테스트용 분리) */
export function pickPm25ForSigungu(
  stations: StationPm25Map,
  sigunguCode: number | undefined,
): number | undefined {
  // 폴백 체인 순회 (순환 방지 visited)
  const visited = new Set<number>();
  let code = sigunguCode;
  while (code !== undefined && !visited.has(code)) {
    visited.add(code);
    for (const name of SIGUNGU_STATIONS[code] ?? []) {
      const value = stations.get(name);
      if (value !== undefined) return value;
    }
    code = SIGUNGU_STATION_FALLBACK[code];
  }
  // 최종 폴백: 강원 전체 유효값 평균
  if (stations.size === 0) return undefined;
  let sum = 0;
  for (const value of stations.values()) sum += value;
  return Math.round(sum / stations.size);
}

/**
 * 시군 대표 PM2.5(㎍/㎥). sigunguCode가 없으면 강원 전체 평균.
 * 유효값이 하나도 없으면 throw — 호출부(live.ts)가 mock으로 폴백한다.
 */
export async function getGangwonPm25(sigunguCode?: number): Promise<number> {
  const stations = await fetchGangwonStationPm25();
  const value = pickPm25ForSigungu(stations, sigunguCode);
  if (value === undefined) {
    throw new Error("AirKorea 강원 측정소에 유효한 PM2.5 값이 없습니다.");
  }
  return value;
}
