/**
 * 강원 민방위 대피시설 좌표 빌드 스크립트 — 실행: npx tsx scripts/build-shelters.ts [--verify-only]
 *
 * 원본: 전국민방위대피시설표준데이터 (행정안전부, 지방행정 인허가데이터개방)
 *   - 데이터셋 페이지: https://www.data.go.kr/data/15021098/standard.do
 *   - 제공 파일: https://file.localdata.go.kr/file/download/civil_defense_shelter_info/info
 *     (키 불필요 — 단 Referer 헤더 없으면 403이라 브라우저형 헤더로 요청)
 *   - EUC-KR CSV, 전국 18,800여 행. 위도/경도(EPSG4326) 컬럼이 있어 좌표 변환 불필요.
 * 변환: 주소가 "강원"으로 시작 + 운영상태 "사용중" + 강원 bbox 내 좌표 필터
 *   → src/data/shelters.gangwon.json (약 700곳)
 * 검증: (1) 18개 시군 모두 대피시설 1곳 이상
 *   (2) 시군청 소재지 18곳이 모두 최근접 대피시설 5km 이내 (도심에는 반드시 있어야 함)
 *   (3) gangwon.json 관광지 전체의 거리 분포 리포트 (shelterPoints 구간별)
 *
 * --verify-only: 다운로드 없이 기존 src/data/shelters.gangwon.json에 대해 검증만 수행
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { haversineKm } from "../src/lib/reco/distance";
import { SIGUNGU_SEATS } from "../src/lib/risk/regions";
import type { Place } from "../src/lib/tour/types";

const DATASET_PAGE = "https://www.data.go.kr/data/15021098/standard.do";
const DOWNLOAD_URL =
  "https://file.localdata.go.kr/file/download/civil_defense_shelter_info/info";
const OUT_PATH = path.join(process.cwd(), "src/data/shelters.gangwon.json");
const GANGWON_JSON = path.join(process.cwd(), "src/data/gangwon.json");

/** JSON 각 레코드에 새기는 출처 표기 (파일 주석이 불가능하므로 필드로 기록) */
const SOURCE =
  "행정안전부 전국민방위대피시설표준데이터 — 공공데이터포털 " + DATASET_PAGE;

interface Shelter {
  name: string;
  lat: number;
  lng: number;
  sigunguCode?: number;
  source: string;
}

/** 따옴표 필드(주소의 쉼표) 지원 CSV 파서 — build-hospitals.ts와 동일 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** 주소의 "{시군}"에서 TourAPI sigunguCode 역매핑 — build-hospitals.ts와 동일 규칙 */
function sigunguCodeFromAddr(addr: string): number | undefined {
  for (const [code, seat] of Object.entries(SIGUNGU_SEATS)) {
    if (addr.includes(` ${seat.name} `) || addr.includes(` ${seat.name}`)) {
      return Number(code);
    }
  }
  return undefined;
}

async function build(): Promise<Shelter[]> {
  console.log(`다운로드: ${DOWNLOAD_URL}`);
  const res = await fetch(DOWNLOAD_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (harinote build-shelters)",
      Referer: "https://file.localdata.go.kr/file/civil_defense_shelter_info/info",
    },
  });
  if (!res.ok) throw new Error(`다운로드 실패: HTTP ${res.status}`);
  const csv = new TextDecoder("euc-kr").decode(await res.arrayBuffer());
  console.log(`CSV ${(csv.length / 1024 / 1024).toFixed(1)}MB 수신 — 파싱`);

  const rows = parseCsv(csv);
  const header = rows[0];
  const col = (name: string) => {
    const idx = header.indexOf(name);
    if (idx < 0) throw new Error(`CSV에 "${name}" 컬럼이 없습니다 — 스키마 변경 여부 확인 필요`);
    return idx;
  };
  const iName = col("시설명");
  const iJibun = col("소재지전체주소");
  const iRoad = col("도로명전체주소");
  const iStatus = col("운영상태");
  const iLat = col("위도(EPSG4326)");
  const iLng = col("경도(EPSG4326)");

  const shelters: Shelter[] = [];
  for (const r of rows.slice(1)) {
    if (r.length <= iLng) continue;
    // 시설명에 "강원"이 든 타지 건물(서울 강원빌딩 등) 오탐 방지 — 주소 접두로만 판별
    if (!r[iJibun]?.startsWith("강원") && !r[iRoad]?.startsWith("강원")) continue;
    if (r[iStatus]?.trim() !== "사용중") continue;
    const lat = Number(r[iLat]);
    const lng = Number(r[iLng]);
    // 강원 bbox 밖 좌표 이상치 제외 (build-hospitals.ts verify와 동일 범위)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < 36.9 || lat > 38.7 || lng < 127 || lng > 129.6) {
      console.warn(`  좌표 이상 — 제외: ${r[iName]} (${lat}, ${lng})`);
      continue;
    }
    const addr = r[iJibun] || r[iRoad];
    shelters.push({
      name: r[iName].trim(),
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      sigunguCode: sigunguCodeFromAddr(addr),
      source: SOURCE,
    });
  }
  shelters.sort(
    (a, b) => (a.sigunguCode ?? 99) - (b.sigunguCode ?? 99) || a.name.localeCompare(b.name, "ko"),
  );

  await writeFile(OUT_PATH, JSON.stringify(shelters, null, 1) + "\n", "utf8");
  console.log(`저장: ${OUT_PATH} (${shelters.length}곳)`);
  return shelters;
}

// ---------------------------------------------------------------------------
// 검증 — 시군 커버리지 + 관광지 거리 분포 (shelterPoints 구간)
// ---------------------------------------------------------------------------
async function verify(shelters: Shelter[]): Promise<void> {
  const nearest = (lat: number, lng: number) =>
    Math.min(...shelters.map((s) => haversineKm(lat, lng, s.lat, s.lng)));

  console.log("\n== 시군별 대피시설 수 ==");
  const bySigungu = new Map<number, number>();
  for (const s of shelters) {
    if (s.sigunguCode !== undefined) {
      bySigungu.set(s.sigunguCode, (bySigungu.get(s.sigunguCode) ?? 0) + 1);
    }
  }
  let missing = 0;
  for (const [code, seat] of Object.entries(SIGUNGU_SEATS)) {
    const n = bySigungu.get(Number(code)) ?? 0;
    if (n === 0) missing++;
    console.log(`  ${seat.name.padEnd(4)} ${String(n).padStart(4)}곳${n === 0 ? "  << 없음" : ""}`);
  }
  if (missing > 0) throw new Error(`대피시설이 없는 시군 ${missing}곳 — 필터/매핑 확인 필요`);

  console.log("\n== 시군청 소재지 커버리지 (기준 5km) ==");
  let uncovered = 0;
  for (const seat of Object.values(SIGUNGU_SEATS)) {
    const d = nearest(seat.lat, seat.lng);
    const over = d > 5;
    if (over) uncovered++;
    console.log(`  ${seat.name.padEnd(4)} ${d.toFixed(1).padStart(5)} km${over ? "  << 5km 초과" : ""}`);
  }
  if (uncovered > 0) {
    throw new Error(`시군청 소재지 ${uncovered}곳이 5km 커버리지를 벗어났습니다 — 좌표 검증 필요`);
  }

  const places = JSON.parse(await readFile(GANGWON_JSON, "utf8")) as Place[];
  const valid = places.filter((p) => p.lat > 36.9 && p.lat < 38.7 && p.lng > 127 && p.lng < 129.6);
  const dists = valid.map((p) => nearest(p.lat, p.lng)).sort((a, b) => a - b);
  const pct = (n: number) => ((100 * n) / valid.length).toFixed(0);
  const b1 = dists.filter((d) => d <= 1).length;
  const b3 = dists.filter((d) => d > 1 && d <= 3).length;
  const b5 = dists.filter((d) => d > 3 && d <= 5).length;
  const over5 = dists.filter((d) => d > 5).length;
  console.log(`\n== 관광지 거리 분포 (좌표 정상 ${valid.length}곳, shelterPoints 구간) ==`);
  console.log(`  ≤1km(0점) ${b1}곳 ${pct(b1)}% / 1~3km(3점) ${b3}곳 ${pct(b3)}% / 3~5km(6점) ${b5}곳 ${pct(b5)}% / >5km(10점) ${over5}곳 ${pct(over5)}%`);
  console.log(
    `  중앙값 ${dists[Math.floor(dists.length / 2)].toFixed(1)}km / 최대 ${dists[dists.length - 1].toFixed(1)}km`,
  );
  console.log("\n검증 통과: 18개 시군 모두 대피시설 확보, 시군청 5km 이내");
}

async function main(): Promise<void> {
  const verifyOnly = process.argv.slice(2).includes("--verify-only");
  const shelters = verifyOnly
    ? (JSON.parse(await readFile(OUT_PATH, "utf8")) as Shelter[])
    : await build();
  await verify(shelters);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
