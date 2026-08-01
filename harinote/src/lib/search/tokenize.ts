/**
 * 한국어 토크나이저 — 형태소 분석기 없이 두 갈래를 합친다.
 *
 * - 어절 토큰: 공백으로 끊은 단어 그대로. 정확 일치의 정밀도를 담당한다.
 * - 문자 bigram: 공백을 지운 전체 문자열을 두 글자씩. "속초해수욕장"에서 "해수"를
 *   뽑아내는 재현율을 담당하고, 어절 경계를 넘기 때문에 "남이 섬"과 "남이섬"이 만난다.
 *
 * mecab-ko 같은 형태소 분석기는 네이티브 의존성이라 배포가 번거롭고,
 * 2천여 건 규모에서는 bigram으로 충분하다.
 */
import { normalize } from "@/lib/search/normalize";

export function tokenize(text: string): string[] {
  const terms: string[] = [];

  for (const word of text.split(/\s+/)) {
    const w = normalize(word);
    if (w.length > 1) terms.push(w);
  }

  const joined = normalize(text);
  if (joined.length === 1) return [joined];
  for (let i = 0; i + 2 <= joined.length; i++) {
    terms.push(joined.slice(i, i + 2));
  }

  return terms;
}
