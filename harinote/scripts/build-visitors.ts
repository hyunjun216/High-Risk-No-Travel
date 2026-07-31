/**
 * 강원 주요관광지점 입장객수 빌드 스크립트 — 실행: npx tsx scripts/build-visitors.ts [--verify-only]
 *
 * 원본: 주요관광지점 입장객통계 (문화체육관광부·한국문화관광연구원, 관광자원통계서비스)
 *   - 데이터셋 페이지: https://www.data.go.kr/data/15000366/openapi.do
 *   - 엔드포인트: getPchrgTrrsrtVisitorList (유료관광지점 방문객수, XML)
 *   - TOUR_API_KEY 재사용 — 단 data.go.kr에서 이 API 활용신청(자동승인)이 따로 필요.
 *     미신청 시 resultCode 30 "SERVICE KEY IS NOT REGISTERED" (산불위험예보 forest.ts와 동일 전례)
 * 수집: 공표 최신월(현재월-2부터 역방향 탐색) 포함 최근 12개월 합산 = 연간 입장객수
 * 매칭: gangwon.json title과 지점명 정규화 매칭 (완전일치 → 4자+ 상호 포함, 시군 일치 우선)
 *   → src/data/visitors.gangwon.json
 * 한계: "유료" 관광지점 위주 통계 — 무료 지점(해수욕장 등)은 미포함, 인기순에서 뒤로 밀림
 *
 * --verify-only: 다운로드 없이 기존 src/data/visitors.gangwon.json에 대해 검증만 수행
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeTitle, type VisitorEntry } from "../src/lib/visitors";
import { CURATED_PLACES } from "../src/lib/curation";
import { SIGUNGU_SEATS } from "../src/lib/risk/regions";
import type { Place } from "../src/lib/tour/types";

try {
  process.loadEnvFile(".env.local");
} catch {
  // --verify-only는 .env.local 없이도 동작해야 한다
}

const DATASET_PAGE = "https://www.data.go.kr/data/15000366/openapi.do";
const ENDPOINT =
  "http://openapi.tour.go.kr/openapi/service/TourismResourceStatsService/getPchrgTrrsrtVisitorList";
const OUT_PATH = path.join(process.cwd(), "src/data/visitors.gangwon.json");
const GANGWON_JSON = path.join(process.cwd(), "src/data/gangwon.json");

/** JSON 각 레코드에 새기는 출처 표기 (파일 주석이 불가능하므로 필드로 기록) */
const SOURCE =
  "문화체육관광부·한국문화관광연구원 주요관광지점 입장객통계 — 공공데이터포털 " +
  DATASET_PAGE;

/** 지점명 → contentId 수동 연결 — 자동 매칭이 놓치는 대표 지점만 (리포트 보고 채운다) */
const OVERRIDES: Record<string, number> = {};

interface StatRow {
  resNm: string;
  gungu: string;
  visitors: number;
}

// ---------------------------------------------------------------------------
// 수집
// ---------------------------------------------------------------------------

/** YYYYMM 문자열 — offset개월 전 */
function ymAgo(base: Date, offset: number): string {
  const d = new Date(base.getFullYear(), base.getMonth() - offset, 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m?.[1];
}

async function fetchMonth(key: string, ym: string, sido: string): Promise<StatRow[]> {
  const rows: StatRow[] = [];
  for (let pageNo = 1; ; pageNo++) {
    const url =
      `${ENDPOINT}?serviceKey=${encodeURIComponent(key)}` +
      `&YM=${ym}&SIDO=${encodeURIComponent(sido)}&numOfRows=1000&pageNo=${pageNo}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} (YM=${ym})`);
    const xml = await res.text();
    const code = tag(xml, "resultCode");
    if (code === "30" || /SERVICE KEY IS NOT REGISTERED/i.test(xml)) {
      throw new Error(
        `TOUR_API_KEY가 이 API에 등록되지 않았습니다 — data.go.kr에서 활용신청(자동승인) 필요: ${DATASET_PAGE}`,
      );
    }
    if (code !== "00" && code !== "0000") {
      throw new Error(`API 오류 resultCode=${code} (YM=${ym}): ${tag(xml, "resultMsg")}`);
    }
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    for (const item of items) {
      const resNm = tag(item, "resNm")?.trim();
      const gungu = tag(item, "gungu")?.trim() ?? "";
      const nat = Number(tag(item, "csNatCnt") ?? 0);
      const forCnt = Number(tag(item, "csForCnt") ?? 0);
      if (!resNm) continue;
      const visitors = (Number.isFinite(nat) ? nat : 0) + (Number.isFinite(forCnt) ? forCnt : 0);
      rows.push({ resNm, gungu, visitors });
    }
    const total = Number(tag(xml, "totalCount") ?? 0);
    if (pageNo * 1000 >= total || items.length === 0) break;
  }
  return rows;
}

/** 공표 최신월 탐색 — 현재월-2부터 역방향 6개월, SIDO 표기 후보 순회 */
async function findLatest(key: string): Promise<{ ym: string; sido: string }> {
  const now = new Date();
  for (let off = 2; off <= 7; off++) {
    const ym = ymAgo(now, off);
    for (const sido of ["강원특별자치도", "강원도", "강원"]) {
      const rows = await fetchMonth(key, ym, sido);
      if (rows.length > 0) {
        console.log(`공표 최신월: ${ym} (SIDO="${sido}", ${rows.length}개 지점)`);
        return { ym, sido };
      }
    }
  }
  throw new Error("최근 7개월 내 강원 데이터를 찾지 못했습니다 — SIDO 표기·API 상태 확인 필요");
}

async function collect(): Promise<Map<string, StatRow>> {
  const key = process.env.TOUR_API_KEY;
  if (!key) throw new Error("TOUR_API_KEY가 없습니다 — .env.local 확인");

  const { ym: endYm, sido } = await findLatest(key);
  const now = new Date();
  const endOffset = (now.getFullYear() - Number(endYm.slice(0, 4))) * 12 +
    (now.getMonth() + 1 - Number(endYm.slice(4)));

  // (지점명|군구) 키로 12개월 합산
  const acc = new Map<string, StatRow>();
  for (let i = 0; i < 12; i++) {
    const ym = ymAgo(now, endOffset + i);
    const rows = await fetchMonth(key, ym, sido);
    console.log(`  ${ym}: ${rows.length}개 지점`);
    for (const r of rows) {
      const k = `${r.resNm}|${r.gungu}`;
      const prev = acc.get(k);
      if (prev) prev.visitors += r.visitors;
      else acc.set(k, { ...r });
    }
  }
  const fromYm = ymAgo(now, endOffset + 11);
  console.log(`수집 완료: ${fromYm}~${endYm}, 지점 ${acc.size}곳`);
  // fromYm/toYm은 build()에서 레코드에 새긴다
  collectRange = { fromYm, toYm: endYm };
  return acc;
}

let collectRange = { fromYm: "", toYm: "" };

// ---------------------------------------------------------------------------
// gangwon.json 이름 매칭
// ---------------------------------------------------------------------------

/** 통계의 군구명(예: "속초시") → TourAPI sigunguCode */
function sigunguCodeOfGungu(gungu: string): number | undefined {
  for (const [code, seat] of Object.entries(SIGUNGU_SEATS)) {
    if (gungu.startsWith(seat.name.replace(/[시군]$/, ""))) return Number(code);
  }
  return undefined;
}

function matchPlaces(stats: Map<string, StatRow>, places: Place[]): VisitorEntry[] {
  const byNorm = new Map<string, Place[]>();
  for (const p of places) {
    const n = normalizeTitle(p.title);
    if (!n) continue;
    const list = byNorm.get(n);
    if (list) list.push(p);
    else byNorm.set(n, [p]);
  }

  const entries: VisitorEntry[] = [];
  const unmatched: StatRow[] = [];
  for (const stat of stats.values()) {
    if (stat.visitors <= 0) continue;
    const statNorm = normalizeTitle(stat.resNm);
    const statSigungu = sigunguCodeOfGungu(stat.gungu);

    let candidates: Place[] = [];
    const override = OVERRIDES[stat.resNm];
    if (override !== undefined) {
      candidates = places.filter((p) => p.contentId === override);
    } else if (byNorm.has(statNorm)) {
      candidates = byNorm.get(statNorm)!;
    } else if (statNorm.length >= 4) {
      // 상호 포함 부분일치 — "설악산국립공원" ↔ "설악산" 류
      candidates = places.filter((p) => {
        const n = normalizeTitle(p.title);
        return n.length >= 4 && (n.includes(statNorm) || statNorm.includes(n));
      });
    }
    // 복수 후보: 시군 일치 우선 → 정규화 제목이 가장 긴(가장 구체적인) 것
    if (candidates.length > 1 && statSigungu !== undefined) {
      const same = candidates.filter((p) => p.sigunguCode === statSigungu);
      if (same.length > 0) candidates = same;
    }
    if (candidates.length > 1) {
      const maxLen = Math.max(...candidates.map((p) => normalizeTitle(p.title).length));
      candidates = candidates.filter((p) => normalizeTitle(p.title).length === maxLen);
    }
    if (candidates.length !== 1) {
      unmatched.push(stat);
      continue;
    }
    const place = candidates[0];
    entries.push({
      contentId: place.contentId,
      title: place.title,
      statName: stat.resNm,
      gungu: stat.gungu,
      visitors: stat.visitors,
      fromYm: collectRange.fromYm,
      toYm: collectRange.toYm,
      source: SOURCE,
    });
  }

  entries.sort((a, b) => b.visitors - a.visitors || a.title.localeCompare(b.title, "ko"));
  console.log(`\n매칭: ${entries.length}곳 / 미매칭 지점 ${unmatched.length}곳`);
  const topUnmatched = unmatched.sort((a, b) => b.visitors - a.visitors).slice(0, 15);
  if (topUnmatched.length > 0) {
    console.log("미매칭 상위 (OVERRIDES 후보):");
    for (const s of topUnmatched) {
      console.log(`  ${s.resNm} (${s.gungu}) ${s.visitors.toLocaleString()}명`);
    }
  }
  return entries;
}

async function build(): Promise<VisitorEntry[]> {
  const stats = await collect();
  const places = JSON.parse(await readFile(GANGWON_JSON, "utf8")) as Place[];
  const entries = matchPlaces(stats, places);
  await writeFile(OUT_PATH, JSON.stringify(entries, null, 1) + "\n", "utf8");
  console.log(`저장: ${OUT_PATH} (${entries.length}곳)`);
  return entries;
}

// ---------------------------------------------------------------------------
// 검증 — 매칭 수·정합성 + 육안 확인 리포트
// ---------------------------------------------------------------------------
async function verify(entries: VisitorEntry[]): Promise<void> {
  const places = JSON.parse(await readFile(GANGWON_JSON, "utf8")) as Place[];
  const ids = new Set(places.map((p) => p.contentId));

  if (entries.length < 30) {
    throw new Error(`매칭 ${entries.length}곳 — 최소 30곳 미달, 매칭 규칙/OVERRIDES 보강 필요`);
  }
  for (const e of entries) {
    if (!Number.isFinite(e.visitors) || e.visitors <= 0) {
      throw new Error(`입장객수 이상: ${e.statName} = ${e.visitors}`);
    }
    if (!ids.has(e.contentId)) {
      throw new Error(`gangwon.json에 없는 contentId: ${e.contentId} (${e.title})`);
    }
  }

  const matched = new Set(entries.map((e) => e.contentId));
  const curatedHit = CURATED_PLACES.filter((c) => matched.has(c.contentId));
  console.log(`\n== 큐레이션 TOP10 커버리지: ${curatedHit.length}/10 ==`);

  const bySigungu = new Map<string, number>();
  for (const e of entries) {
    bySigungu.set(e.gungu, (bySigungu.get(e.gungu) ?? 0) + 1);
  }
  console.log("\n== 시군별 매칭 수 ==");
  for (const [gungu, n] of [...bySigungu].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${gungu.padEnd(6)} ${n}곳`);
  }

  console.log("\n== 입장객수 상위 20곳 (지점명 ↔ 관광지 title 육안 확인) ==");
  for (const e of entries.slice(0, 20)) {
    console.log(
      `  ${e.visitors.toLocaleString().padStart(12)}명  ${e.statName} ↔ ${e.title} (${e.gungu})`,
    );
  }
  console.log(`\n검증 통과: ${entries.length}곳 매칭 (${entries[0]?.fromYm}~${entries[0]?.toYm})`);
}

async function main(): Promise<void> {
  const verifyOnly = process.argv.slice(2).includes("--verify-only");
  const entries = verifyOnly
    ? (JSON.parse(await readFile(OUT_PATH, "utf8")) as VisitorEntry[])
    : await build();
  await verify(entries);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
