/**
 * 검색어·문서 텍스트 정규화 — 색인과 질의가 **같은 함수**를 통과해야 매칭이 성립한다.
 *
 * 하는 일: 유니코드 NFKC(전각→반각, NFD 자모→조합형) → 소문자 → 문자·숫자 외 제거.
 * "남이 섬"과 "남이섬", "보광사(속초)"와 "보광사 속초"를 같은 문자열로 만든다.
 */

/** 한글 음절의 초성 19자 (호환 자모 — 사용자가 키보드로 입력하는 문자와 동일) */
const CHOSEONG = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
/** NFKC가 호환 자모(ㄱ)를 한글 자모(U+1100)로 바꾸므로 되돌린다 — 초성 질의가 색인과 어긋나지 않게 */
const JAMO_CHOSEONG = "ᄀᄁᄂᄃᄄᄅᄆᄇᄈᄉᄊᄋᄌᄍᄎᄏᄐᄑᄒ";
const JUNGSEONG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const JAMO_JUNGSEONG = "ᅡᅢᅣᅤᅥᅦᅧᅨᅩᅪᅫᅬᅭᅮᅯᅰᅱᅲᅳᅴᅵ";

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
/** 초성 하나가 담당하는 음절 수 (중성 21 × 종성 28) */
const CHOSEONG_SPAN = 588;

const TO_COMPAT = new Map<string, string>();
for (let i = 0; i < JAMO_CHOSEONG.length; i++) {
  TO_COMPAT.set(JAMO_CHOSEONG[i], CHOSEONG[i]);
}
for (let i = 0; i < JAMO_JUNGSEONG.length; i++) {
  TO_COMPAT.set(JAMO_JUNGSEONG[i], JUNGSEONG[i]);
}

export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "")
    .replace(/[ᄀ-ᅵ]/g, (c) => TO_COMPAT.get(c) ?? c);
}

/** 한글 음절을 초성으로 치환한다. 한글이 아닌 문자는 그대로 둔다. */
export function choseongOf(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    out +=
      code >= HANGUL_BASE && code <= HANGUL_LAST
        ? CHOSEONG[Math.floor((code - HANGUL_BASE) / CHOSEONG_SPAN)]
        : ch;
  }
  return out;
}

/** 입력이 자음만으로 이루어졌는지 — 초성 색인으로 라우팅할지 판단한다 */
export function isChoseongQuery(text: string): boolean {
  const n = normalize(text);
  return n.length > 0 && [...n].every((ch) => CHOSEONG.includes(ch));
}
