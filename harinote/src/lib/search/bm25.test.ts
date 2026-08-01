import { describe, expect, it } from "vitest";
import { buildIndex, queryIndex } from "@/lib/search/bm25";

const WEIGHTS = { title: 3, body: 1 };

const index = buildIndex(
  [
    { contentId: 1, fields: { title: "설악산 케이블카", body: "" } },
    { contentId: 2, fields: { title: "설악산책", body: "케이블카를 타고 오른다" } },
    { contentId: 3, fields: { title: "속초 해수욕장", body: "여름 피서지" } },
  ],
  WEIGHTS,
);

describe("queryIndex", () => {
  it("점수 내림차순으로 반환한다", () => {
    const hits = queryIndex(index, "케이블카");
    const scores = hits.map((h) => h.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("제목에서 맞은 문서가 본문에서 맞은 문서보다 위다", () => {
    const hits = queryIndex(index, "케이블카");
    expect(hits[0].contentId).toBe(1);
  });

  it("맞는 문서가 없으면 빈 배열", () => {
    expect(queryIndex(index, "제주도")).toEqual([]);
  });

  it("빈 질의는 빈 배열", () => {
    expect(queryIndex(index, "  ")).toEqual([]);
  });

  it("어느 한 단어라도 맞으면 결과에 포함한다", () => {
    const ids = queryIndex(index, "케이블카 해수욕장").map((h) => h.contentId);
    expect(ids).toContain(1);
    expect(ids).toContain(3);
  });

  it("희귀한 단어가 흔한 단어보다 순위를 지배한다", () => {
    // '설악산'은 3건 중 2건에 있고 '해수욕장'은 1건뿐 — 둘 다 맞은 질의에서 희귀어 쪽이 위
    const hits = queryIndex(index, "설악산 해수욕장");
    expect(hits[0].contentId).toBe(3);
  });
});

describe("질의어 커버리지 컷오프", () => {
  // '설악없는단어'는 여섯 조각 중 '설악' 하나만 우연히 걸린다 — 잡아내야 할 잡음
  it("질의의 일부 조각만 스친 문서는 버린다", () => {
    expect(queryIndex(index, "설악없는단어", { minCoverage: 0.5 })).toEqual([]);
  });

  it("컷오프를 끄면 스친 문서도 남는다", () => {
    expect(queryIndex(index, "설악없는단어").length).toBeGreaterThan(0);
  });

  it("질의어를 충분히 맞춘 문서는 컷오프를 통과한다", () => {
    const hits = queryIndex(index, "케이블카", { minCoverage: 0.5 });
    expect(hits.map((h) => h.contentId)).toContain(1);
  });
});

describe("문서 길이 정규화", () => {
  const lengthIndex = buildIndex(
    [
      { contentId: 1, fields: { title: "폭포", body: "" } },
      {
        contentId: 2,
        fields: {
          title: "폭포 계곡 산장 전망대 주차장 매점 야영장 산책로",
          body: "",
        },
      },
    ],
    WEIGHTS,
  );

  it("같은 단어를 가졌다면 짧은 문서가 위다", () => {
    expect(queryIndex(lengthIndex, "폭포")[0].contentId).toBe(1);
  });
});

describe("필드 가중치", () => {
  it("가중치를 바꾸면 순위가 바뀐다", () => {
    const bodyHeavy = buildIndex(
      [
        { contentId: 1, fields: { title: "케이블카", body: "" } },
        { contentId: 2, fields: { title: "산책", body: "케이블카" } },
      ],
      { title: 1, body: 10 },
    );
    expect(queryIndex(bodyHeavy, "케이블카")[0].contentId).toBe(2);
  });
});
