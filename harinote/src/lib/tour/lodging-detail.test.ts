import { describe, expect, it } from "vitest";
import {
  extractLodgingIntro,
  extractLodgingRooms,
  firstPhoneOf,
  priceRangeOf,
} from "./lodging-detail";

function wrap(items: unknown, resultCode = "0000") {
  return {
    response: {
      header: { resultCode, resultMsg: "OK" },
      body: { items },
    },
  };
}

/** 실응답 형태(contentId 2708335)를 축약한 객실 1건 */
const ROOM_ITEM = {
  roomtitle: "황토방",
  roombasecount: "2",
  roommaxcount: "4",
  roomsize2: "39.6",
  roomoffseasonminfee1: "100000",
  roomoffseasonminfee2: "120000",
  roompeakseasonminfee1: "130000",
  roompeakseasonminfee2: "130000",
  roomaircondition: "Y",
  roomtv: "Y",
  roompc: "",
  roomimg1: "http://tong.visitkorea.or.kr/a.jpg",
  roomimg1alt: "황토방 5",
  roomimg2: "",
};

describe("extractLodgingRooms", () => {
  it("객실 기본 정보·요금·사진·편의시설을 정규화", () => {
    const [room] = extractLodgingRooms(wrap({ item: ROOM_ITEM }));
    expect(room.title).toBe("황토방");
    expect(room.baseCount).toBe(2);
    expect(room.maxCount).toBe(4);
    expect(room.sizeM2).toBe(39.6);
    expect(room.fees).toEqual({
      offPeakWeekday: 100000,
      offPeakWeekend: 120000,
      peakWeekday: 130000,
      peakWeekend: 130000,
    });
    expect(room.images).toEqual([
      { url: "http://tong.visitkorea.or.kr/a.jpg", alt: "황토방 5" },
    ]);
  });

  it('편의시설은 "Y"인 것만 라벨로 (빈 값은 제외)', () => {
    const [room] = extractLodgingRooms(wrap({ item: ROOM_ITEM }));
    expect(room.amenities).toEqual(["에어컨", "TV"]);
    expect(room.amenities).not.toContain("PC");
  });

  it('미등록 요금("0"·빈값)은 undefined', () => {
    const [room] = extractLodgingRooms(
      wrap({
        item: {
          roomtitle: "기본실",
          roomoffseasonminfee1: "0",
          roomoffseasonminfee2: "",
          roompeakseasonminfee1: "80000",
        },
      }),
    );
    expect(room.fees.offPeakWeekday).toBeUndefined();
    expect(room.fees.offPeakWeekend).toBeUndefined();
    expect(room.fees.peakWeekday).toBe(80000);
  });

  it("item이 단일 객체여도 배열로 처리, 이름 없는 항목은 제외", () => {
    expect(extractLodgingRooms(wrap({ item: ROOM_ITEM }))).toHaveLength(1);
    expect(
      extractLodgingRooms(wrap({ item: [{ roomtitle: "" }, ROOM_ITEM] })),
    ).toHaveLength(1);
  });

  it('결과 없음(items="")·오류 코드·형식 불일치는 빈 배열', () => {
    expect(extractLodgingRooms(wrap(""))).toEqual([]);
    expect(extractLodgingRooms(wrap({ item: ROOM_ITEM }, "03"))).toEqual([]);
    expect(extractLodgingRooms({})).toEqual([]);
    expect(extractLodgingRooms(null)).toEqual([]);
    expect(extractLodgingRooms("oops")).toEqual([]);
  });
});

describe("priceRangeOf", () => {
  it("등록된 모든 요금의 최소·최대", () => {
    const rooms = extractLodgingRooms(
      wrap({
        item: [
          ROOM_ITEM,
          { roomtitle: "곰동", roomoffseasonminfee1: "230000", roompeakseasonminfee2: "320000" },
        ],
      }),
    );
    expect(priceRangeOf(rooms)).toEqual({ min: 100000, max: 320000 });
  });

  it("요금이 하나도 없으면 undefined (화면은 '미제공'으로 안내)", () => {
    const rooms = extractLodgingRooms(
      wrap({ item: { roomtitle: "기본실", roomoffseasonminfee1: "0" } }),
    );
    expect(rooms).toHaveLength(1);
    expect(priceRangeOf(rooms)).toBeUndefined();
    expect(priceRangeOf([])).toBeUndefined();
  });
});

describe("extractLodgingIntro", () => {
  it('부대시설은 "1" 플래그만 라벨로 — 자유 텍스트 필드와 섞여 온다', () => {
    const intro = extractLodgingIntro(
      wrap({
        item: {
          checkintime: "14:00",
          checkouttime: "12:00",
          chkcooking: "가능",
          parkinglodging: "가능(무료)",
          subfacility: "루프탑, 산책로",
          barbecue: "1",
          campfire: "1",
          sauna: "0",
          karaoke: "",
        },
      }),
    );
    expect(intro?.facilities).toEqual(["바비큐", "캠프파이어"]);
    expect(intro?.cooking).toBe("가능");
    expect(intro?.parking).toBe("가능(무료)");
    expect(intro?.checkIn).toBe("14:00");
  });

  it("텍스트 필드의 HTML·개행을 정리", () => {
    const intro = extractLodgingIntro(
      wrap({ item: { infocenterlodging: "033-336-3357<br>\n010-5322-3967" } }),
    );
    expect(intro?.tel).toBe("033-336-3357 010-5322-3967");
  });

  it('결과 없음·오류 코드·빈 항목은 undefined', () => {
    expect(extractLodgingIntro(wrap(""))).toBeUndefined();
    expect(
      extractLodgingIntro(wrap({ item: { checkintime: "14:00" } }, "03")),
    ).toBeUndefined();
    expect(extractLodgingIntro(wrap({ item: { contentid: "1" } }))).toBeUndefined();
    expect(extractLodgingIntro(null)).toBeUndefined();
  });
});

describe("firstPhoneOf", () => {
  it("여러 번호 중 첫 번째만 (tel: 링크용)", () => {
    expect(firstPhoneOf("033-336-3357 010-5322-3967")).toBe("033-336-3357");
    expect(firstPhoneOf("0507-1393-4207")).toBe("0507-1393-4207");
  });

  it("번호가 없으면 undefined", () => {
    expect(firstPhoneOf("예약 문의")).toBeUndefined();
    expect(firstPhoneOf(undefined)).toBeUndefined();
  });
});
