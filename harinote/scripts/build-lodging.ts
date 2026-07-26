/**
 * 숙박(contentTypeId 32) 수집 — 실행: pnpm build:lodging (TOUR_API_KEY 필요)
 *
 * N박 코스 추천의 숙소 후보 전용 별도 fixture(src/data/lodging.gangwon.json).
 * 메인 gangwon.json(SUPPORTED_CONTENT_TYPE_IDS = 12/14/39, 필터 탭·점수 대상)과
 * 분리해 계약 파일을 건드리지 않는다 — 숙박은 코스 추천에서만 쓴다.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchAreaBasedPage, toPlace } from "../src/lib/tour/client";

process.loadEnvFile(".env.local");

/** 코스 추천에 필요한 최소 필드 — Place 전체를 싣지 않아 JSON을 가볍게 유지 */
export interface LodgingEntry {
  contentId: number;
  title: string;
  addr: string;
  sigunguCode?: number;
  lat: number;
  lng: number;
  imageUrl?: string;
  cat3?: string;
}

const NUM_OF_ROWS = 100;

async function main(): Promise<void> {
  const key = process.env.TOUR_API_KEY;
  if (!key) {
    throw new Error(
      "TOUR_API_KEY가 설정되지 않았습니다. .env.local을 확인하세요.",
    );
  }

  const entries: LodgingEntry[] = [];
  let pageNo = 1;
  for (;;) {
    const { items, totalCount } = await fetchAreaBasedPage(key, 32, pageNo);
    for (const item of items) {
      const place = toPlace(item);
      if (!place) continue;
      entries.push({
        contentId: place.contentId,
        title: place.title,
        addr: place.addr,
        sigunguCode: place.sigunguCode,
        lat: place.lat,
        lng: place.lng,
        imageUrl: place.imageUrl,
        cat3: place.cat3,
      });
    }
    if (items.length < NUM_OF_ROWS) break;
    if (totalCount > 0 && pageNo * NUM_OF_ROWS >= totalCount) break;
    pageNo++;
  }

  const outPath = path.join("src", "data", "lodging.gangwon.json");
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(entries, null, 1)}\n`, "utf8");
  console.log(`숙박 ${entries.length}건 → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
