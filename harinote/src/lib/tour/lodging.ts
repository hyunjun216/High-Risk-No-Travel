/**
 * 숙박(contentTypeId 32) 후보 — N박 코스 추천 전용.
 * scripts/build-lodging.ts가 만든 내장 JSON을 읽는다 (네트워크·키 불필요).
 * 메인 관광지 데이터셋(gangwon.json)과 분리 — 필터 탭·목록에는 노출하지 않는다.
 */
import lodgingJson from "@/data/lodging.gangwon.json";
import type { Place } from "@/lib/tour/types";

/** 숙박을 PlaceWithSafety 계산에 태우기 위한 Place 형태 (envType은 실내 고정) */
export type LodgingPlace = Pick<
  Place,
  | "contentId"
  | "contentTypeId"
  | "title"
  | "addr"
  | "sigunguCode"
  | "lat"
  | "lng"
  | "envType"
  | "imageUrl"
  | "cat3"
>;

interface RawLodging {
  contentId: number;
  title: string;
  addr: string;
  sigunguCode?: number;
  lat: number;
  lng: number;
  imageUrl?: string;
  cat3?: string;
}

let cache: LodgingPlace[] | null = null;

/** 내장 숙박 목록 — 손상 항목은 건너뛴다 (빈 배열이어도 코스는 숙소 없이 동작) */
export function getLodgings(): LodgingPlace[] {
  if (cache) return cache;
  const raw = lodgingJson as unknown;
  const list: LodgingPlace[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw as RawLodging[]) {
      if (
        typeof item !== "object" ||
        item === null ||
        typeof item.contentId !== "number" ||
        typeof item.title !== "string" ||
        typeof item.lat !== "number" ||
        typeof item.lng !== "number"
      ) {
        continue;
      }
      list.push({
        contentId: item.contentId,
        contentTypeId: 32,
        title: item.title,
        addr: typeof item.addr === "string" ? item.addr : "",
        sigunguCode:
          typeof item.sigunguCode === "number" ? item.sigunguCode : undefined,
        lat: item.lat,
        lng: item.lng,
        imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : undefined,
        cat3: typeof item.cat3 === "string" ? item.cat3 : undefined,
        // 숙박은 건물 내 체류가 기본 — 기상 영향 실내 할인 적용
        envType: "indoor",
      });
    }
  }
  cache = list;
  return list;
}
