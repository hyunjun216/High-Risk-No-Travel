/**
 * 검색 진입점 — 내장 데이터를 색인해 "검색어 → contentId별 점수"를 낸다.
 *
 * 파이프라인 (RAG 리트리버와 같은 순서):
 *   질의 정규화·초성 판별 → 동의어 확장 → BM25F 검색 → 점수 반환
 * 순위에 안전점수를 섞는 재순위는 목록 페이지(places-sort.ts)가 맡는다 —
 * 이 모듈은 "검색어와 얼마나 맞는가"만 책임진다.
 *
 * 색인은 첫 검색 때 한 번 만들어 프로세스가 살아 있는 동안 재사용한다.
 * 빌드타임 산출물(JSON 커밋)을 두지 않는 이유: 2천여 건이라 구축이 수백 ms고,
 * 색인 파일과 원본 데이터가 어긋날 위험이 사라진다.
 */
import { buildIndex, queryIndex, type SearchHit } from "@/lib/search/bm25";
import { choseongOf, isChoseongQuery, normalize } from "@/lib/search/normalize";
import { suggestCorrection } from "@/lib/search/suggest";
import { queryVariants } from "@/lib/search/synonyms";
import { getPlaces } from "@/lib/datasource";
import { getLodgings } from "@/lib/tour/lodging";
import { cardSummary } from "@/lib/tour/overviews";
import { summaryOf } from "@/lib/tour/summaries";
import { placeTypeLabel } from "@/lib/tour/types";
import type { Place } from "@/lib/tour/types";

export type { SearchHit };

/**
 * 필드 가중치 — 제목에서 맞은 것과 소개글에 스쳐 지나간 것의 값 차이.
 * 근거는 관측: 이름 검색이 압도적으로 많고(제목 3.0), 지역명 검색이 그다음이며(주소 1.5),
 * 소개글은 "케이블카"처럼 이름에 없는 특징을 찾을 때만 의미가 있다(1.0~1.2).
 */
const WEIGHTS = { title: 3, addr: 1.5, summary: 1.2, overview: 1, category: 1 };
/** 초성 색인은 제목만 대상 — 주소·소개글까지 초성으로 맞추면 노이즈만 늘어난다 */
const CHOSEONG_WEIGHTS = { choseong: 1 };

type Indexable = Pick<Place, "contentId" | "title" | "addr"> &
  Partial<Pick<Place, "contentTypeId" | "cat3">>;

function toIndexDocs(places: Indexable[]) {
  return places.map((p) => ({
    contentId: p.contentId,
    fields: {
      title: p.title,
      addr: p.addr,
      summary: (summaryOf(p.contentId) ?? []).join(" "),
      overview: cardSummary(p.contentId) ?? "",
      category:
        p.contentTypeId === undefined
          ? ""
          : placeTypeLabel({ contentTypeId: p.contentTypeId, cat3: p.cat3 }),
    },
  }));
}

function toChoseongDocs(places: Indexable[]) {
  return places.map((p) => ({
    contentId: p.contentId,
    fields: { choseong: choseongOf(normalize(p.title)) },
  }));
}

interface Corpus {
  main: ReturnType<typeof buildIndex>;
  choseong: ReturnType<typeof buildIndex>;
  /** 오타 제안이 대조할 어휘 — 관광지 이름의 어절 (주소·소개글은 제안 대상이 아니다) */
  vocabulary: string[];
  /** 한 글자 검색용 원문 — 색인은 두 글자 단위라 한 글자는 걸리지 않는다 */
  texts: { contentId: number; title: string; addr: string }[];
}

function buildVocabulary(places: Indexable[]): string[] {
  const words = new Set<string>();
  for (const p of places) {
    for (const word of p.title.split(/\s+/)) {
      if (normalize(word).length > 1) words.add(word);
    }
  }
  return [...words];
}

function buildCorpus(places: Indexable[]): Corpus {
  return {
    main: buildIndex(toIndexDocs(places), WEIGHTS),
    choseong: buildIndex(toChoseongDocs(places), CHOSEONG_WEIGHTS),
    vocabulary: buildVocabulary(places),
    texts: places.map((p) => ({
      contentId: p.contentId,
      title: normalize(p.title),
      addr: normalize(p.addr),
    })),
  };
}

/**
 * 한 글자 질의는 색인(두 글자 단위)으로 잡히지 않으므로 원문을 직접 훑는다.
 * 점수는 필드 가중치를 그대로 써서 이름에서 맞은 곳이 주소에서 맞은 곳보다 위로 온다.
 */
function singleCharSearch(corpus: Corpus, ch: string): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const doc of corpus.texts) {
    if (doc.title.includes(ch)) {
      hits.push({ contentId: doc.contentId, score: WEIGHTS.title });
    } else if (doc.addr.includes(ch)) {
      hits.push({ contentId: doc.contentId, score: WEIGHTS.addr });
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}

/** 질의어 조각의 절반은 맞아야 결과로 인정 — bigram이 끌고 오는 우연한 겹침을 자른다 */
const MIN_COVERAGE = 0.5;
/** 동의어로 찾은 결과는 감점 — 사용자가 실제로 친 말과 맞은 곳이 위로 온다 */
const SYNONYM_PENALTY = 0.7;

function run(corpus: Corpus, query: string): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  // 자음만 입력 → 초성 색인으로 라우팅 (동의어 변형은 의미가 없으므로 건너뛴다)
  if (isChoseongQuery(q)) {
    return queryIndex(corpus.choseong, q, { minCoverage: MIN_COVERAGE });
  }
  const normalized = normalize(q);
  if (normalized.length === 1) return singleCharSearch(corpus, normalized);

  // 변형마다 따로 검색하고 문서별 최고 점수를 취한다 — 이어붙인 한 방 질의로는
  // 커버리지 컷오프가 동의어 결과를 통째로 잘라버린다 (synonyms.ts 참고)
  const best = new Map<number, number>();
  queryVariants(q).forEach((variant, i) => {
    const factor = i === 0 ? 1 : SYNONYM_PENALTY;
    for (const hit of queryIndex(corpus.main, variant, {
      minCoverage: MIN_COVERAGE,
    })) {
      const score = hit.score * factor;
      if (score > (best.get(hit.contentId) ?? 0)) best.set(hit.contentId, score);
    }
  });

  return [...best]
    .map(([contentId, score]) => ({ contentId, score }))
    .sort((a, b) => b.score - a.score);
}

/** 관광지 색인 — DATA_SOURCE에 따라 대상이 달라지므로 datasource를 거친다 */
let placesCorpus: Promise<Corpus> | null = null;

export async function searchPlaces(query: string): Promise<SearchHit[]> {
  if (!query.trim()) return [];
  placesCorpus ??= getPlaces().then(buildCorpus);
  return run(await placesCorpus, query);
}

/** 검색 결과가 0건일 때만 호출할 것 — 오타 제안의 발동 조건 (suggest.ts) */
export async function suggestPlaceQuery(query: string): Promise<string | null> {
  if (!query.trim() || isChoseongQuery(query)) return null;
  placesCorpus ??= getPlaces().then(buildCorpus);
  return suggestCorrection(query, (await placesCorpus).vocabulary);
}

/** 숙박 색인 — 별도 데이터셋이라 IDF를 섞지 않는다 (탭이 갈려 있어 결과도 섞이지 않음) */
let lodgingCorpus: Corpus | null = null;

export function searchLodgings(query: string): SearchHit[] {
  if (!query.trim()) return [];
  lodgingCorpus ??= buildCorpus(getLodgings());
  return run(lodgingCorpus, query);
}

export function suggestLodgingQuery(query: string): string | null {
  if (!query.trim() || isChoseongQuery(query)) return null;
  lodgingCorpus ??= buildCorpus(getLodgings());
  return suggestCorrection(query, lodgingCorpus.vocabulary);
}
