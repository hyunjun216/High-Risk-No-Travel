/**
 * 강원 주요관광지점 입장객수 빌드 스크립트 — 실행: npx tsx scripts/build-visitors.ts [--verify-only]
 *
 * 원본: 주요관광지점 입장객통계 (문화체육관광부·한국문화관광연구원, 국가승인통계 113005)
 *   - 관광지식정보시스템 통계표: https://know.tour.go.kr/stat/visitStatDis/table.do
 *   - 화면의 조회를 그대로 호출한다(statTableData.do) — 연도별·강원 전체·유료+무료
 *
 * 왜 OpenAPI가 아닌가: 같은 통계의 공공데이터포털 API(getPchrgTrrsrtVisitorList)는
 *   활용신청이 승인돼도 레거시 게이트웨이(openapi.tour.go.kr)가 키를 인식하지 못한다
 *   (2026-08-05 실측 resultCode 30, 포털 참고문서도 "(복구중)" 표기). 게다가 그 API는
 *   **유료** 지점만 담아 해수욕장 등 무료 명소가 통째로 빠진다. 이 경로는 유료+무료 전체이고
 *   연 확정치를 쓰므로 근거가 더 넓고 깔끔하다. 인증키 불필요.
 *
 * 수집: 최신 확정 연도(현재연도-1부터 역방향 탐색)의 연간 방문자수 = 내국인+외국인 합계 행
 * 매칭: gangwon.json title과 지점명 정규화 매칭 (완전일치 → 4자+ 상호 포함, 시군 일치 우선)
 *   → src/data/visitors.gangwon.json
 *
 * --verify-only: 다운로드 없이 기존 src/data/visitors.gangwon.json에 대해 검증만 수행
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeTitle, type VisitorEntry } from "../src/lib/visitors";
import { CURATED_PLACES } from "../src/lib/curation";
import { SIGUNGU_SEATS } from "../src/lib/risk/regions";
import type { Place } from "../src/lib/tour/types";

const BASE = "https://know.tour.go.kr/stat/visitStatDis";
const TABLE_PAGE = `${BASE}/table.do`;
const DATA_ENDPOINT = `${BASE}/statTableData.do`;
/** 통계표 화면의 시도 코드 — 강원특별자치도 */
const GANGWON_SIDO = "4200000000";
const OUT_PATH = path.join(process.cwd(), "src/data/visitors.gangwon.json");
const GANGWON_JSON = path.join(process.cwd(), "src/data/gangwon.json");

/** JSON 각 레코드에 새기는 출처 표기 (파일 주석이 불가능하므로 필드로 기록) */
const SOURCE =
  "문화체육관광부·한국문화관광연구원 주요관광지점 입장객통계 — 관광지식정보시스템 " +
  TABLE_PAGE;

/**
 * 지점명 → contentId 수동 연결 — 자동 매칭이 놓치는 대표 지점만 (리포트 보고 채운다).
 * **같은 입장 대상일 때만** 넣는다. 통계 지점과 TourAPI 관광지는 1:1이 아니라서
 * (레고랜드·남이섬·강원랜드는 gangwon.json에 항목 자체가 없다) 인접·유사만으로 잇지 않는다 —
 * 인기순은 "이 관광지에 몇 명이 왔나"를 말하는 자리이지 리조트 단지 합계를 말하는 자리가 아니다.
 */
const OVERRIDES: Record<string, number> = {
  // 통계는 낙산사 경내 전체 입장객, gangwon.json은 그 대표 지점인 의상대로 들어 있다(동일 입장권)
  낙산사: 125795,
  // 같은 시설을 이름만 달리 적은 경우 — 부분일치 방향 제한에 걸려 자동으로는 안 붙는다
  설악워터피아: 126714, // ↔ 한화리조트 설악 워터피아
  무릉계곡: 125673, // ↔ 무릉계곡 용추폭포(강원) — 용추폭포가 무릉계곡 탐방로의 종점, 동일 입장
};

interface StatRow {
  resNm: string;
  gungu: string;
  visitors: number;
}

// ---------------------------------------------------------------------------
// 수집
// ---------------------------------------------------------------------------

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m?.[1];
}

/** 지점명 셀은 CDATA로 감싼 <a> 링크다 — 태그를 걷어내고 이름만 */
function plainName(cell: string): string {
  return cell
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]*>/g, "")
    .trim();
}

/**
 * 세션 쿠키 확보 — 조회는 통계표 화면의 세션을 요구한다(쿠키 없이 호출하면 HTTP 500).
 */
async function openSession(): Promise<string> {
  const res = await fetch(TABLE_PAGE);
  if (!res.ok) throw new Error(`통계표 화면 열기 실패: HTTP ${res.status}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("세션 쿠키를 받지 못했습니다 — 사이트 구조 변경 확인 필요");
  return cookie;
}

/**
 * 한 해의 강원 전체 지점 조회.
 * 화면이 보내는 파라미터를 **전부** 실어야 한다 — 빈 값이라도 빠지면 HTTP 500이다(실측).
 */
async function fetchYear(cookie: string, year: number): Promise<StatRow[]> {
  const params = new URLSearchParams({
    searchDateDivision: "C", // A=월별 B=분기별 C=년도별
    searchClass: "A", // A=전체 C=유료 F=무료 — 무료 지점(해수욕장 등)까지 포함한다
    searchStartYear: String(year),
    searchEndYear: String(year),
    searchStartMonth: "",
    searchEndMonth: "",
    searchStartQuarter: "",
    searchEndQuarter: "",
    searchBCType: "",
    searchMCType: "",
    searchSCType: "",
    searchSido: GANGWON_SIDO,
    searchGungu: "",
    searchSightsNm: "",
    searchAddr: GANGWON_SIDO,
  });

  const res = await fetch(`${DATA_ENDPOINT}?${params}`, { headers: { cookie } });
  if (!res.ok) throw new Error(`조회 실패 HTTP ${res.status} (${year}년)`);
  const xml = await res.text();

  const rows: StatRow[] = [];
  for (const row of xml.match(/<row[\s\S]*?<\/row>/g) ?? []) {
    // 지점마다 내국인·외국인·합계 세 행이 온다 — 합계만 취한다
    if (tag(row, "NF_GB")?.trim() !== "합계") continue;
    const resNm = plainName(tag(row, "RES_NM") ?? "");
    const visitors = Number(tag(row, "TOTAL") ?? 0);
    if (!resNm || !Number.isFinite(visitors)) continue;
    rows.push({ resNm, gungu: tag(row, "GUNGU_NM")?.trim() ?? "", visitors });
  }
  return rows;
}

/** 최신 확정 연도 탐색 — 확정치는 이듬해 6월 공표라 현재연도-1부터 역방향 */
async function collect(): Promise<{ rows: StatRow[]; year: number }> {
  const cookie = await openSession();
  const thisYear = new Date().getFullYear();
  for (let year = thisYear - 1; year >= thisYear - 3; year--) {
    const rows = await fetchYear(cookie, year);
    if (rows.length > 0) {
      const sum = rows.reduce((a, r) => a + r.visitors, 0);
      console.log(
        `수집 완료: ${year}년 확정치, 지점 ${rows.length}곳 (총 ${sum.toLocaleString()}명)`,
      );
      return { rows, year };
    }
    console.log(`  ${year}년: 데이터 없음 — 이전 연도로`);
  }
  throw new Error("최근 3년 내 강원 데이터를 찾지 못했습니다 — 사이트 구조·조회 조건 확인 필요");
}

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

function matchPlaces(
  stats: StatRow[],
  places: Place[],
  year: number,
): VisitorEntry[] {
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
  for (const stat of stats) {
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
      // 부분일치는 **관광지명이 통계 지점명에 포함되는 방향만** 허용한다
      // ("휘닉스 파크" ⊂ "휘닉스파크(스키장)"). 관광지가 통계보다 더 구체적인 반대 방향은
      // 리조트 전체 방문객을 그 안의 작은 시설에 붙이는 과대계상이 된다
      // ("알펜시아리조트(골프장)" → "알펜시아리조트대관령스키역사관"). 그런 대응은 OVERRIDES로만.
      candidates = places.filter((p) => {
        const n = normalizeTitle(p.title);
        return n.length >= 4 && statNorm.includes(n);
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
      year,
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
  const { rows, year } = await collect();
  const places = JSON.parse(await readFile(GANGWON_JSON, "utf8")) as Place[];
  const entries = matchPlaces(rows, places, year);
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
  console.log(`\n검증 통과: ${entries.length}곳 매칭 (${entries[0]?.year}년 확정치)`);
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
