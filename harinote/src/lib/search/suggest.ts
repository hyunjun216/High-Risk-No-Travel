/**
 * 오타 제안 — 검색 결과가 0건일 때만 쓰는 폴백.
 *
 * 항상 켜면 정밀도가 무너진다("경포"를 "경포대"로 멋대로 바꾸는 식). 결과가
 * 하나도 없을 때 "혹시 이걸 찾으셨나요?"로만 제시한다.
 *
 * bigram 유사도가 아니라 글자 편집거리를 쓰는 이유: 한글은 한 글자만 틀려도
 * ("설악산"→"설앙산") 두 글자 조각이 통째로 어긋나 bigram 겹침이 0이 된다.
 */
import { normalize } from "@/lib/search/normalize";

/** 이 이상 고쳐야 하면 오타가 아니라 다른 말이다 */
const MAX_DISTANCE = 1;
/** 짧은 말이 통째로 바뀌는 것을 막는 하한 (1 - 거리/길이) */
const MIN_SIMILARITY = 0.6;

/** 레벤슈타인 거리 — 두 행만 유지하는 표준 DP */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/** 사전에서 가장 가까운 말 — 오타로 볼 만큼 가깝지 않으면 null */
function nearest(word: string, vocabulary: string[]): string | null {
  const target = normalize(word);
  if (!target) return null;

  let best: string | null = null;
  let bestDistance = MAX_DISTANCE + 1;
  for (const candidate of vocabulary) {
    const d = editDistance(target, normalize(candidate));
    if (d === 0) return null; // 이미 있는 말 — 고칠 게 없다
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }

  if (!best) return null;
  const similarity = 1 - bestDistance / Math.max(target.length, best.length);
  return similarity >= MIN_SIMILARITY ? best : null;
}

/**
 * 검색어의 어절을 하나씩 사전과 대조해 고친다.
 * 하나도 고칠 게 없으면 null (제안을 띄우지 않는다).
 */
export function suggestCorrection(
  query: string,
  vocabulary: string[],
): string | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  let changed = false;
  const corrected = words.map((word) => {
    const fix = nearest(word, vocabulary);
    if (!fix) return word;
    changed = true;
    return fix;
  });

  return changed ? corrected.join(" ") : null;
}
