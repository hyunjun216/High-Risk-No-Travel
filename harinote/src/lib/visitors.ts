/**
 * 관광지 입장객수 — /places 인기순 정렬 근거.
 *
 * 데이터: src/data/visitors.gangwon.json — 문화체육관광부·한국문화관광연구원
 * 주요관광지점 입장객통계(공공데이터포털 OpenAPI)의 강원 최근 12개월 합산분.
 * scripts/build-visitors.ts가 gangwon.json 관광지에 이름 매칭으로 연결해 생성·검증한다.
 *
 * 한계: 유료 관광지점 위주 통계라 무료 지점(해수욕장 등)은 다수 미포함 —
 * 미매칭 관광지는 인기순에서 뒤로 밀리며(places-sort.ts), 그 안에서는 안전점수순.
 */
import visitorsJson from "@/data/visitors.gangwon.json";

export interface VisitorEntry {
  contentId: number;
  title: string;
  /** 통계 원본의 관광지점명 (title과 다를 수 있음 — 매칭 근거 보존) */
  statName: string;
  gungu: string;
  /** 최근 12개월 입장객수 합 (내국인+외국인) */
  visitors: number;
  fromYm: string;
  toYm: string;
  source: string;
}

/** 통계 지점명 ↔ 관광지 title 매칭용 정규화 — NFC → 소문자 → 괄호 내용 제거 → 한글·영숫자만 */
export function normalizeTitle(s: string): string {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^가-힣a-z0-9]/g, "");
}

/**
 * contentId → 입장객수 Map — 한 관광지에 복수 지점(예: 설악산 지구별)이 매칭되면 합산.
 * 파일 손상·형식 오류 시 빈 Map이 되고 인기순은 안전점수순처럼 동작한다 (무장애).
 */
export function buildVisitorsMap(entries: unknown): Map<number, number> {
  const map = new Map<number, number>();
  if (!Array.isArray(entries)) return map;
  for (const e of entries as VisitorEntry[]) {
    if (Number.isFinite(e?.contentId) && Number.isFinite(e?.visitors) && e.visitors > 0) {
      map.set(e.contentId, (map.get(e.contentId) ?? 0) + e.visitors);
    }
  }
  return map;
}

const VISITORS = buildVisitorsMap(visitorsJson);

/** 최근 12개월 입장객수 — 통계에 매칭되지 않은 관광지는 undefined */
export function visitorCount(contentId: number): number | undefined {
  return VISITORS.get(contentId);
}

/**
 * 입장객 통계가 한 건이라도 있는지 — 전건 미매칭이면 인기순 결과가 안전점수순과
 * 완전히 같아지므로(places-sort.ts) 드롭다운에서 인기순을 감추는 판단에 쓴다.
 */
export function hasVisitorData(): boolean {
  return VISITORS.size > 0;
}

/** 출처 표기 — UI 각주용 */
export function visitorsDataSource(): string {
  return "문화체육관광부·한국문화관광연구원 주요관광지점 입장객통계(공공데이터포털)";
}
