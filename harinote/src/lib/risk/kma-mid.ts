/**
 * 기상청 중기예보(MidFcstInfoService) 클라이언트 — D+4~D+10.
 *
 * 단기예보(kma.ts)는 오늘~D+3까지만 준다. 그 뒤는 30년 계절 통계로 대신하고 있었는데,
 * 중기예보를 붙이면 **여행 계획 구간 대부분(1~2주 전)이 실예보 기반**이 된다.
 *
 * 중기예보가 주지 않는 것: 풍속·강수량·습도(체감온도). TCI가 "없는 축은 제외 후
 * 재정규화"하도록 이미 설계돼 있어 그대로 흘려보낸다 — 정보 없는 축이 불이익을 주지 않는다.
 *
 * 서비스 두 개를 합쳐 하루를 만든다:
 *   · getMidTa       기온 — 지점 단위(시군별로 코드가 따로 있다)
 *   · getMidLandFcst 강수확률·하늘상태 — 광역 단위(영서/영동 둘뿐)
 *
 * 서버 전용 — KMA_API_KEY는 클라이언트 번들에 노출 금지.
 */
import { z } from "zod";
import { createTtlCache } from "./cache";

const TA_URL = "https://apis.data.go.kr/1360000/MidFcstInfoService/getMidTa";
const LAND_URL = "https://apis.data.go.kr/1360000/MidFcstInfoService/getMidLandFcst";

/**
 * 시군 → 중기기온 예보구역코드.
 * 출처: 기상청 중기예보 오픈API 활용가이드 첨부 `중기예보_중기기온예보구역코드_2025.12.xlsx`
 * (특성 C = 육상예보·중기기온 조회 가능). **강원 18개 시군이 전부 1:1로 대응된다.**
 *
 * ⚠ 이 표는 실호출로 검증했다. 이전에 docs/API키_발급_가이드.md가 적어 둔
 *   "원주 11D10501"은 오류이고, 11D10501은 **영월**이다(원주는 11D10401).
 */
export const MID_TA_REG_ID: Record<number, string> = {
  1: "11D20501", // 강릉시
  2: "11D20402", // 고성군
  3: "11D20601", // 동해시
  4: "11D20602", // 삼척시
  5: "11D20401", // 속초시
  6: "11D10202", // 양구군
  7: "11D20403", // 양양군
  8: "11D10501", // 영월군
  9: "11D10401", // 원주시
  10: "11D10201", // 인제군
  11: "11D10502", // 정선군
  12: "11D10101", // 철원군
  13: "11D10301", // 춘천시
  14: "11D20301", // 태백시
  15: "11D10503", // 평창군
  16: "11D10302", // 홍천군
  17: "11D10102", // 화천군
  18: "11D10402", // 횡성군
};

/** 시군 → 중기육상예보 구역(강수확률·하늘상태). 기상청 분류상 태백은 영동이다. */
const YEONGDONG = new Set([1, 2, 3, 4, 5, 7, 14]); // 강릉·고성·동해·삼척·속초·양양·태백
export function midLandRegId(sigunguCode: number): string {
  return YEONGDONG.has(sigunguCode) ? "11D20000" : "11D10000";
}

/**
 * 중기예보가 커버하는 범위 — 발표일 기준 N일 후.
 *
 * ⚠ 실측(2026-08-03): **06시 발표는 D+4부터, 18시 발표는 D+5부터** 준다.
 *   18시 응답에는 `taMin4`/`taMax4` 필드 자체가 없다. 그래서 라우팅 상한(MID_MAX_OFFSET)만
 *   상수로 두고, 하한은 발표시각에 따라 달라지므로 `combineMid`가 값이 없으면 null을
 *   돌려주는 것으로 자연히 처리한다 — 그 경우 호출부가 계절 모드로 폴백한다.
 */
export const MID_MIN_OFFSET = 4;
export const MID_MAX_OFFSET = 10;

export interface MidDailyWeather {
  /** 일 최고기온 ℃ */
  tempC: number;
  /** 일 최저기온 ℃ — 한파 축 입력 */
  tminC: number;
  /** 강수확률 % (오전·오후 중 큰 값. D+8~10은 일 단위 단일값) */
  rainProbPct?: number;
  /** 일조시간 대용(h) — 하늘상태(wf) 환산. TCI 일조 축 입력 */
  sunHours?: number;
}

/**
 * 발표시각(tmFc) 선택 — 중기예보는 하루 두 번(06:00 / 18:00) 발표된다.
 * 단기예보와 같은 이유로 반영 지연을 감안해 10분 여유를 둔다.
 */
export function pickMidBaseTime(now: Date = new Date()): { tmFc: string; baseDate: Date } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) if (p.type !== "literal") parts[p.type] = p.value;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const ymd = `${parts.year}${parts.month}${parts.day}`;
  const asDate = (s: string) =>
    new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00+09:00`);

  if (minutes >= 18 * 60 + 10) return { tmFc: `${ymd}1800`, baseDate: asDate(ymd) };
  if (minutes >= 6 * 60 + 10) return { tmFc: `${ymd}0600`, baseDate: asDate(ymd) };
  // 자정~06:10 — 전날 18시 발표 (KST는 DST가 없어 -24h가 정확히 전날)
  const prev = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" })
    .format(new Date(now.getTime() - 86_400_000))
    .replaceAll("-", "");
  return { tmFc: `${prev}1800`, baseDate: asDate(prev) };
}

/**
 * 하늘상태 문자열 → 일조시간 대용(h).
 * 단기예보 SKY 환산(kma.ts)과 눈금을 맞춘다: 맑음 11h · 구름많음 4h · 흐림 1h.
 * 비·눈이 섞인 표현("구름많고 비")은 흐림으로 본다 — 일조는 어차피 적다.
 */
export function wfToSunHours(wf: string | undefined): number | undefined {
  if (!wf) return undefined;
  if (wf.includes("비") || wf.includes("눈") || wf.includes("흐림")) return 1;
  if (wf.includes("구름많음")) return 4;
  if (wf.includes("구름조금") || wf.includes("맑음")) return 11;
  return undefined;
}

const midResponseSchema = z.object({
  response: z.object({
    header: z.object({ resultCode: z.string(), resultMsg: z.string().optional() }),
    body: z
      .object({ items: z.object({ item: z.array(z.record(z.string(), z.unknown())) }).optional() })
      .optional(),
  }),
});

function requireApiKey(): string {
  const key = process.env.KMA_API_KEY;
  if (!key) throw new Error("KMA_API_KEY가 설정되지 않았습니다 (.env.local)");
  return key;
}

async function fetchMid(url: string, regId: string, tmFc: string): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({
    serviceKey: requireApiKey(),
    dataType: "JSON",
    regId,
    tmFc,
    numOfRows: "10",
    pageNo: "1",
  });
  const res = await fetch(`${url}?${params}`, {
    signal: AbortSignal.timeout(5000),
    next: { revalidate: 60 * 60 },
  });
  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    const msg = /<returnAuthMsg>([^<]*)<\/returnAuthMsg>/.exec(text)?.[1];
    throw new Error(`중기예보 API가 XML 오류를 반환했습니다: ${msg ?? "원인 불명"}`);
  }
  const parsed = midResponseSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error("중기예보 응답이 예상 스키마와 다릅니다");
  const { resultCode, resultMsg } = parsed.data.response.header;
  if (resultCode !== "00") {
    throw new Error(`중기예보 API 오류: resultCode=${resultCode} ${resultMsg ?? ""}`);
  }
  const item = parsed.data.response.body?.items?.item?.[0];
  if (!item) throw new Error("중기예보 응답에 항목이 없습니다");
  return item;
}

/** 기온·육상 응답을 하루치로 합친다. 필수값(기온)이 없으면 null. */
export function combineMid(
  ta: Record<string, unknown>,
  land: Record<string, unknown>,
  offset: number,
): MidDailyWeather | null {
  const num = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const tempC = num(ta[`taMax${offset}`]);
  const tminC = num(ta[`taMin${offset}`]);
  if (tempC === undefined || tminC === undefined) return null;

  // D+3~7은 오전/오후 분리, D+8~10은 일 단위 단일값
  const am = num(land[`rnSt${offset}Am`]);
  const pm = num(land[`rnSt${offset}Pm`]);
  const single = num(land[`rnSt${offset}`]);
  const probs = [am, pm, single].filter((v): v is number => v !== undefined);
  const rainProbPct = probs.length ? Math.max(...probs) : undefined;

  const wfs = [land[`wf${offset}Am`], land[`wf${offset}Pm`], land[`wf${offset}`]]
    .map((v) => wfToSunHours(typeof v === "string" ? v : undefined))
    .filter((v): v is number => v !== undefined);
  // 오전·오후가 다르면 나쁜 쪽(일조 적은 쪽)을 취한다 — 쾌적 판단은 보수적으로
  const sunHours = wfs.length ? Math.min(...wfs) : undefined;

  return { tempC, tminC, ...(rainProbPct !== undefined ? { rainProbPct } : {}), ...(sunHours !== undefined ? { sunHours } : {}) };
}

/** 구역·발표시각 단위 1시간 캐시 (실패는 5분 후 재시도) — 시군 18곳이라 호출이 적다 */
const taCache = createTtlCache<Record<string, unknown>>(60 * 60 * 1000, 5 * 60 * 1000);
const landCache = createTtlCache<Record<string, unknown>>(60 * 60 * 1000, 5 * 60 * 1000);

/**
 * 시군·날짜 → 중기예보 하루 요약. 범위 밖이거나 조회 실패면 null
 * (호출부는 계절 모드로 폴백한다).
 */
export async function fetchMidDailyWeather(
  sigunguCode: number,
  targetISO: string,
  now: Date = new Date(),
): Promise<MidDailyWeather | null> {
  const taReg = MID_TA_REG_ID[sigunguCode];
  if (!taReg) return null;

  const { tmFc, baseDate } = pickMidBaseTime(now);
  const target = new Date(`${targetISO}T00:00:00+09:00`);
  const offset = Math.round((target.getTime() - baseDate.getTime()) / 86_400_000);
  if (offset < MID_MIN_OFFSET || offset > MID_MAX_OFFSET) return null;

  const landReg = midLandRegId(sigunguCode);
  const [ta, land] = await Promise.all([
    taCache.get(`${taReg},${tmFc}`, () => fetchMid(TA_URL, taReg, tmFc)),
    landCache.get(`${landReg},${tmFc}`, () => fetchMid(LAND_URL, landReg, tmFc)),
  ]);
  return combineMid(ta, land, offset);
}
