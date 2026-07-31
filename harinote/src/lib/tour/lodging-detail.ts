/**
 * TourAPI(KorService2) 숙박(contentTypeId 32) 상세 — 객실·요금(detailInfo2)과
 * 기본정보(detailIntro2) 조회. 서버 전용.
 *
 * 안정성 계약 (images.ts·overview.ts와 동일 원칙):
 * - TOUR_API_KEY가 없으면 네트워크 호출 없이 빈 값 ("키 없으면 네트워크 0")
 * - 호출 실패·오류 응답도 throw 없이 빈 값 — 화면은 해당 정보를 "미제공"으로 안내
 * - contentId당 24시간 캐시(객실·요금은 자주 안 변함), 실패는 5분 뒤 재시도
 *
 * 값 형식이 필드마다 달라 정규화가 필요하다 (2026-07 실응답 확인, contentId 2708335):
 * - 요금: 콤마 없는 숫자 문자열("100000"), 미등록은 "0" 또는 빈 문자열
 * - 객실 편의시설(roomaircondition 등): "Y" 또는 빈 문자열
 * - 기본정보 부대시설(barbecue 등): "1"/"0" 플래그 — 같은 응답에서 자유 텍스트
 *   필드(checkintime "14:00", parkinglodging "가능(무료)")와 섞여 온다
 */
import { z } from "zod";
import { createTtlCache } from "@/lib/risk/cache";

const BASE_URL = "https://apis.data.go.kr/B551011/KorService2";

/** 객실 카드에 노출할 사진 최대 장수 — API가 roomimg1~5까지 준다 */
const ROOM_IMAGE_SLOTS = [1, 2, 3, 4, 5] as const;

export interface LodgingRoomFees {
  /** 비수기 주중 최소요금 */
  offPeakWeekday?: number;
  /** 비수기 주말 최소요금 */
  offPeakWeekend?: number;
  /** 성수기 주중 최소요금 */
  peakWeekday?: number;
  /** 성수기 주말 최소요금 */
  peakWeekend?: number;
}

export interface LodgingRoom {
  title: string;
  /** 기준 인원 */
  baseCount?: number;
  /** 최대 인원 */
  maxCount?: number;
  /** 면적(㎡) */
  sizeM2?: number;
  fees: LodgingRoomFees;
  images: { url: string; alt: string }[];
  /** "Y"로 확인된 객실 편의시설 라벨 */
  amenities: string[];
}

export interface LodgingIntro {
  checkIn?: string;
  checkOut?: string;
  roomCount?: string;
  roomType?: string;
  parking?: string;
  tel?: string;
  cooking?: string;
  /** 부대시설 자유 텍스트 (예: "루프탑, 산책로, 축구장") */
  subFacility?: string;
  foodPlace?: string;
  reservation?: string;
  scale?: string;
  refundPolicy?: string;
  /** "1" 플래그로 확인된 부대시설 라벨 */
  facilities: string[];
}

const apiString = z.union([z.string(), z.number()]).transform((v) => String(v));

const roomItemSchema = z.looseObject({
  roomtitle: apiString.optional(),
  roombasecount: apiString.optional(),
  roommaxcount: apiString.optional(),
  roomsize2: apiString.optional(),
  roomoffseasonminfee1: apiString.optional(),
  roomoffseasonminfee2: apiString.optional(),
  roompeakseasonminfee1: apiString.optional(),
  roompeakseasonminfee2: apiString.optional(),
});

const introItemSchema = z.looseObject({
  checkintime: apiString.optional(),
  checkouttime: apiString.optional(),
  roomcount: apiString.optional(),
  roomtype: apiString.optional(),
  parkinglodging: apiString.optional(),
  infocenterlodging: apiString.optional(),
  chkcooking: apiString.optional(),
  subfacility: apiString.optional(),
  foodplace: apiString.optional(),
  reservationlodging: apiString.optional(),
  scalelodging: apiString.optional(),
  refundregulation: apiString.optional(),
});

/** 결과가 없으면 items가 빈 문자열 ""로 온다 (목록 API와 동일한 특성) */
function responseSchema<T extends z.ZodTypeAny>(item: T) {
  return z.looseObject({
    response: z.looseObject({
      header: z.looseObject({ resultCode: apiString }),
      body: z
        .looseObject({
          items: z
            .union([
              z.literal(""),
              z.looseObject({
                item: z.union([item, z.array(item)]).optional(),
              }),
            ])
            .optional(),
        })
        .optional(),
    }),
  });
}

const roomResponseSchema = responseSchema(roomItemSchema);
const introResponseSchema = responseSchema(introItemSchema);


/** 콤마 없는 숫자 문자열 → 원 단위 금액. 미등록("0"·빈값·비숫자)은 undefined */
function feeOf(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw.replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function countOf(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function sizeOf(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** 객실 편의시설 — 응답 필드명 → 표시 라벨. 값이 "Y"인 것만 노출한다 */
const ROOM_AMENITY_LABELS: Record<string, string> = {
  roomaircondition: "에어컨",
  roomtv: "TV",
  roominternet: "인터넷",
  roomrefrigerator: "냉장고",
  roomcook: "취사도구",
  roombathfacility: "욕실",
  roombath: "욕조",
  roomtoiletries: "세면도구",
  roomhairdryer: "드라이어",
  roomsofa: "소파",
  roomtable: "테이블",
  roompc: "PC",
  roomcable: "케이블TV",
  roomhometheater: "홈시어터",
};

/** 숙소 부대시설 — 값이 "1"인 것만 노출한다 (자유 텍스트 필드와 형식이 다름) */
const INTRO_FACILITY_LABELS: Record<string, string> = {
  barbecue: "바비큐",
  campfire: "캠프파이어",
  sports: "스포츠시설",
  sauna: "사우나",
  beauty: "뷰티시설",
  beverage: "식음료장",
  karaoke: "노래방",
  seminar: "세미나실",
  bicycle: "자전거대여",
  fitness: "휘트니스",
  publicpc: "공용PC",
  publicbath: "공용샤워실",
};

/**
 * 자유 텍스트 정리 — 이 API는 텍스트 필드에 HTML을 섞어 보낸다
 * (예: tel "033-336-3357<br>\n010-5322-3967"). overview.ts와 같은 규칙.
 */
function cleanText(raw: string | undefined): string | undefined {
  const t = raw
    ?.replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return t ? t : undefined;
}

/** 전화 링크(tel:)용 첫 번째 번호 — 여러 번호가 함께 오는 경우가 있다 */
export function firstPhoneOf(raw: string | undefined): string | undefined {
  return raw?.match(/0\d{1,3}-\d{3,4}-\d{4}/)?.[0];
}

/** detailInfo2 응답 JSON → 객실 목록 (이름 없는 항목은 제외) */
export function extractLodgingRooms(json: unknown): LodgingRoom[] {
  const parsed = roomResponseSchema.safeParse(json);
  if (!parsed.success) return [];
  if (parsed.data.response.header.resultCode !== "0000") return [];
  const items = parsed.data.response.body?.items;
  if (!items || typeof items === "string") return [];
  const raw = items.item === undefined ? [] : [items.item].flat();

  const rooms: LodgingRoom[] = [];
  for (const item of raw) {
    const title = cleanText(item.roomtitle);
    if (!title) continue;

    const loose = item as Record<string, unknown>;
    const str = (k: string) =>
      typeof loose[k] === "string" ? (loose[k] as string) : undefined;

    const images = ROOM_IMAGE_SLOTS.map((i) => ({
      url: str(`roomimg${i}`)?.trim() ?? "",
      alt: str(`roomimg${i}alt`)?.trim() ?? title,
    })).filter((img) => /^https?:\/\//.test(img.url));

    const amenities = Object.entries(ROOM_AMENITY_LABELS)
      .filter(([field]) => str(field)?.trim().toUpperCase() === "Y")
      .map(([, label]) => label);

    rooms.push({
      title,
      baseCount: countOf(item.roombasecount),
      maxCount: countOf(item.roommaxcount),
      sizeM2: sizeOf(item.roomsize2),
      fees: {
        offPeakWeekday: feeOf(item.roomoffseasonminfee1),
        offPeakWeekend: feeOf(item.roomoffseasonminfee2),
        peakWeekday: feeOf(item.roompeakseasonminfee1),
        peakWeekend: feeOf(item.roompeakseasonminfee2),
      },
      images,
      amenities,
    });
  }
  return rooms;
}

/** detailIntro2 응답 JSON → 기본정보. 채워진 항목이 하나도 없으면 undefined */
export function extractLodgingIntro(json: unknown): LodgingIntro | undefined {
  const parsed = introResponseSchema.safeParse(json);
  if (!parsed.success) return undefined;
  if (parsed.data.response.header.resultCode !== "0000") return undefined;
  const items = parsed.data.response.body?.items;
  if (!items || typeof items === "string") return undefined;
  const item = (items.item === undefined ? [] : [items.item].flat())[0];
  if (!item) return undefined;

  const loose = item as Record<string, unknown>;
  const facilities = Object.entries(INTRO_FACILITY_LABELS)
    .filter(([field]) => String(loose[field] ?? "").trim() === "1")
    .map(([, label]) => label);

  const intro: LodgingIntro = {
    checkIn: cleanText(item.checkintime),
    checkOut: cleanText(item.checkouttime),
    roomCount: cleanText(item.roomcount),
    roomType: cleanText(item.roomtype),
    parking: cleanText(item.parkinglodging),
    tel: cleanText(item.infocenterlodging),
    cooking: cleanText(item.chkcooking),
    subFacility: cleanText(item.subfacility),
    foodPlace: cleanText(item.foodplace),
    reservation: cleanText(item.reservationlodging),
    scale: cleanText(item.scalelodging),
    refundPolicy: cleanText(item.refundregulation),
    facilities,
  };

  const hasAny =
    facilities.length > 0 ||
    Object.entries(intro).some(([k, v]) => k !== "facilities" && v !== undefined);
  return hasAny ? intro : undefined;
}

/**
 * 객실 요금 전체에서 1박 가격 범위. 등록된 요금이 하나도 없으면 undefined —
 * 화면은 이때 "가격 미제공"으로 안내한다 (섹션을 숨기지 않는다).
 */
export function priceRangeOf(
  rooms: LodgingRoom[],
): { min: number; max: number } | undefined {
  const fees = rooms.flatMap((r) =>
    [
      r.fees.offPeakWeekday,
      r.fees.offPeakWeekend,
      r.fees.peakWeekday,
      r.fees.peakWeekend,
    ].filter((f): f is number => f !== undefined),
  );
  if (fees.length === 0) return undefined;
  return { min: Math.min(...fees), max: Math.max(...fees) };
}

const roomCache = createTtlCache<LodgingRoom[]>(
  24 * 60 * 60 * 1000,
  5 * 60 * 1000,
);
const introCache = createTtlCache<LodgingIntro | undefined>(
  24 * 60 * 60 * 1000,
  5 * 60 * 1000,
);

function detailParams(key: string, contentId: number): URLSearchParams {
  return new URLSearchParams({
    serviceKey: key,
    MobileOS: "ETC",
    MobileApp: "harinote",
    _type: "json",
    contentId: String(contentId),
    contentTypeId: "32",
  });
}

/** 숙박 객실·요금 (detailInfo2) — 실패·키 없음은 빈 배열 */
export async function fetchLodgingRooms(
  contentId: number,
): Promise<LodgingRoom[]> {
  const key = process.env.TOUR_API_KEY;
  if (!key) return [];

  try {
    return await roomCache.get(String(contentId), async () => {
      const res = await fetch(
        `${BASE_URL}/detailInfo2?${detailParams(key, contentId).toString()}`,
      );
      if (!res.ok) throw new Error(`detailInfo2 HTTP ${res.status}`);
      // 키 오류 등은 XML로 온다 → JSON.parse 실패로 취급
      return extractLodgingRooms(JSON.parse(await res.text()));
    });
  } catch {
    return [];
  }
}

/** 숙박 기본정보 (detailIntro2) — 실패·키 없음은 undefined */
export async function fetchLodgingIntro(
  contentId: number,
): Promise<LodgingIntro | undefined> {
  const key = process.env.TOUR_API_KEY;
  if (!key) return undefined;

  try {
    return await introCache.get(String(contentId), async () => {
      const res = await fetch(
        `${BASE_URL}/detailIntro2?${detailParams(key, contentId).toString()}`,
      );
      if (!res.ok) throw new Error(`detailIntro2 HTTP ${res.status}`);
      return extractLodgingIntro(JSON.parse(await res.text()));
    });
  } catch {
    return undefined;
  }
}
