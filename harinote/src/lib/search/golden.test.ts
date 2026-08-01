/**
 * 검색 골든셋 — "이 검색어를 치면 이게 나와야 한다"의 단일 기준.
 *
 * 기대값은 내장 실데이터(gangwon.json / overviews.json / summaries.json)에서
 * 확인한 실제 contentId다. 검색 로직을 바꿀 때 이 파일이 회귀를 잡는다.
 *
 * 유형: 정확일치(회귀) · 띄어쓰기 · 초성 · 본문어 · 지역 · 동의어 · 0건
 */
import { describe, expect, it } from "vitest";
import { searchPlaces } from "@/lib/search/places";
import { getPlaces } from "@/lib/datasource";

/** 상위 k위 안에 해당 contentId가 있는지 */
function rankOf(hits: { contentId: number }[], contentId: number): number {
  return hits.findIndex((h) => h.contentId === contentId) + 1;
}

async function expectWithinTop(q: string, contentId: number, k: number) {
  const rank = rankOf(await searchPlaces(q), contentId);
  expect(
    rank >= 1 && rank <= k,
    `"${q}" → contentId ${contentId} 순위 ${rank || "미포함"} (상위 ${k} 기대)`,
  ).toBe(true);
}

describe("골든셋: 정확 일치 (기존 동작 회귀 방지)", () => {
  it("설악산 → 설악산 권금성·케이블카가 상위 10", async () => {
    await expectWithinTop("설악산", 125798, 10);
    await expectWithinTop("설악산", 128788, 10);
  });

  it("정동진 → 정동진이 1위", async () => {
    expect((await searchPlaces("정동진"))[0].contentId).toBe(3545967);
  });
});

describe("골든셋: 띄어쓰기 무시", () => {
  it("'설악 산' → 설악산 케이블카가 상위 10", async () => {
    await expectWithinTop("설악 산", 128788, 10);
  });

  it("'경포 호수광장' → 경포호수광장이 상위 5", async () => {
    await expectWithinTop("경포 호수광장", 3454461, 5);
  });
});

describe("골든셋: 초성 검색", () => {
  it("ㅈㄷㅈ → 정동진이 상위 10", async () => {
    await expectWithinTop("ㅈㄷㅈ", 3545967, 10);
  });

  it("ㅅㅇㄱㄷ → 소양강댐이 상위 10", async () => {
    await expectWithinTop("ㅅㅇㄱㄷ", 127476, 10);
  });
});

describe("골든셋: 본문에만 있는 단어 (현재는 0건인 영역)", () => {
  it("산책로 → 제목에 없는 단어인데도 20곳 이상 검색된다", async () => {
    expect((await searchPlaces("산책로")).length).toBeGreaterThanOrEqual(20);
  });

  it("산책로 → 직연폭포(본문에만 언급)가 결과에 포함", async () => {
    expect(rankOf(await searchPlaces("산책로"), 125648)).toBeGreaterThan(0);
  });

  it("케이블카 → 제목 보유 관광지가 본문 언급보다 위", async () => {
    const hits = await searchPlaces("케이블카");
    expect(rankOf(hits, 2513410)).toBeLessThan(rankOf(hits, 3041402));
  });
});

describe("골든셋: 지역명", () => {
  it("속초 → 주소가 속초인 영랑호가 포함되고 결과가 100곳 이상", async () => {
    const hits = await searchPlaces("속초");
    expect(rankOf(hits, 127565)).toBeGreaterThan(0);
    expect(hits.length).toBeGreaterThanOrEqual(100);
  });

  it("속초 → 제목에 속초가 든 곳이 주소만 속초인 곳보다 위", async () => {
    const hits = await searchPlaces("속초");
    expect(rankOf(hits, 250357)).toBeLessThan(rankOf(hits, 127565));
  });
});

describe("골든셋: 동의어", () => {
  it("해변 → 제목이 '해수욕장'인 곳도 검색된다", async () => {
    // 북분리해수욕장 — 제목·주소 어디에도 '해변'이 없다. 동의어 확장이 유일한 경로.
    expect(rankOf(await searchPlaces("해변"), 125682)).toBeGreaterThan(0);
  });
});

describe("골든셋: 한 글자 검색 (bigram으로는 잡히지 않는 구간)", () => {
  it("'산' → 이름·주소에 '산'이 든 곳이 나온다", async () => {
    expect((await searchPlaces("산")).length).toBeGreaterThanOrEqual(50);
  });

  it("'산' → 이름에 든 곳이 주소에만 든 곳보다 위", async () => {
    const places = await getPlaces();
    const title = new Map(places.map((p) => [p.contentId, p.title]));
    const top = (await searchPlaces("산")).slice(0, 10);
    expect(top.every((h) => title.get(h.contentId)?.includes("산"))).toBe(true);
  });
});

describe("골든셋: 결과 없음", () => {
  it("데이터에 없는 문자열은 0건", async () => {
    expect((await searchPlaces("zzzqqq없는단어")).length).toBe(0);
  });

  it("빈 검색어는 0건 (호출부가 검색 자체를 건너뛴다)", async () => {
    expect((await searchPlaces("   ")).length).toBe(0);
  });
});
