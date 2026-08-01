/**
 * BM25F 색인·스코어러 — 필드별 가중치를 가진 키워드 검색 (순수 모듈, 데이터 비의존).
 *
 * BM25F를 쓰는 이유:
 * - 필드 가중: 제목에서 맞은 것과 소개글에 스쳐 지나간 것을 같게 볼 수 없다.
 * - 문서 길이 정규화(b): 관광지 2천여 곳 중 소개글이 있는 곳은 절반뿐이라,
 *   보정 없이는 글이 긴 문서가 무조건 유리해진다.
 * - IDF: "강원"처럼 어디에나 나오는 말의 변별력을 자동으로 깎는다.
 *
 * 파라미터는 BM25 표준 권장값 (Robertson & Zaragoza, "The Probabilistic
 * Relevance Framework: BM25 and Beyond", 2009 §3.2).
 */
import { tokenize } from "@/lib/search/tokenize";

/** 용어 빈도 포화 상수 — 같은 단어가 여러 번 나와도 점수가 무한정 오르지 않게 한다 */
const K1 = 1.2;
/** 문서 길이 정규화 강도 (0=끄기, 1=완전 정규화) */
const B = 0.75;

export interface IndexDoc {
  contentId: number;
  /** 필드명 → 원문 텍스트 */
  fields: Record<string, string>;
}

export interface SearchHit {
  contentId: number;
  score: number;
}

interface DocEntry {
  contentId: number;
  /** 용어 → 필드 가중·길이 보정을 마친 누적 빈도 */
  weightedTf: Map<string, number>;
}

export interface SearchIndex {
  docs: DocEntry[];
  /** 용어 → 그 용어를 가진 문서 수 */
  df: Map<string, number>;
  /** 용어 → 그 용어를 가진 문서들의 인덱스 (전수 순회를 피하기 위한 역색인) */
  postings: Map<string, number[]>;
}

export function buildIndex(
  docs: IndexDoc[],
  weights: Record<string, number>,
): SearchIndex {
  const fieldNames = Object.keys(weights);

  // 1패스: 필드별 토큰화 + 평균 길이 (길이 정규화의 분모)
  const tokenized = docs.map((doc) =>
    fieldNames.map((f) => tokenize(doc.fields[f] ?? "")),
  );
  const avgLen = fieldNames.map((_, fi) => {
    const total = tokenized.reduce((sum, fields) => sum + fields[fi].length, 0);
    return total / Math.max(1, docs.length) || 1;
  });

  // 2패스: 필드 가중·길이 보정을 적용한 용어 빈도를 문서마다 합산
  const entries: DocEntry[] = docs.map((doc, di) => {
    const weightedTf = new Map<string, number>();
    fieldNames.forEach((name, fi) => {
      const terms = tokenized[di][fi];
      if (terms.length === 0) return;
      const norm = 1 - B + (B * terms.length) / avgLen[fi];
      const boost = weights[name] / norm;
      for (const term of terms) {
        weightedTf.set(term, (weightedTf.get(term) ?? 0) + boost);
      }
    });
    return { contentId: doc.contentId, weightedTf };
  });

  const df = new Map<string, number>();
  const postings = new Map<string, number[]>();
  entries.forEach((entry, di) => {
    for (const term of entry.weightedTf.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1);
      const list = postings.get(term);
      if (list) list.push(di);
      else postings.set(term, [di]);
    }
  });

  return { docs: entries, df, postings };
}

/** 확률적 IDF — 흔한 용어일수록 0에 수렴한다 (df=N이어도 음수가 되지 않는 형태) */
function idf(df: number, total: number): number {
  return Math.log(1 + (total - df + 0.5) / (df + 0.5));
}

export interface QueryOptions {
  /**
   * 질의어 조각 중 최소 몇 할을 맞춰야 결과로 인정할지 (0~1, 기본 0 = 컷오프 없음).
   * bigram은 재현율을 크게 올리는 대신 우연한 두 글자 겹침까지 끌고 온다
   * ("없는단어"의 '단어'가 아무 문서에나 걸리는 식). 이 컷오프가 그 잡음을 잘라낸다.
   */
  minCoverage?: number;
}

/** 질의에 맞는 문서를 점수 내림차순으로 반환한다 (OR 검색 + 커버리지 컷오프) */
export function queryIndex(
  index: SearchIndex,
  query: string,
  { minCoverage = 0 }: QueryOptions = {},
): SearchHit[] {
  const terms = new Set(tokenize(query));
  if (terms.size === 0) return [];

  const total = index.docs.length;
  const scores = new Map<number, number>();
  const matched = new Map<number, number>();

  for (const term of terms) {
    const hits = index.postings.get(term);
    if (!hits) continue;
    const weight = idf(index.df.get(term)!, total);
    for (const di of hits) {
      const tf = index.docs[di].weightedTf.get(term)!;
      scores.set(di, (scores.get(di) ?? 0) + (weight * tf) / (K1 + tf));
      matched.set(di, (matched.get(di) ?? 0) + 1);
    }
  }

  const needed = minCoverage * terms.size;
  return [...scores]
    .filter(([di]) => matched.get(di)! >= needed)
    .map(([di, score]) => ({ contentId: index.docs[di].contentId, score }))
    .sort((a, b) => b.score - a.score);
}
