/**
 * 대피소 접근성 — 최근접 민방위 대피시설 거리 실계산.
 *
 * 데이터: src/data/shelters.gangwon.json — 강원 민방위 대피시설 702곳(운영상태 "사용중")
 * 좌표 내장. scripts/build-shelters.ts가 행정안전부 전국민방위대피시설표준데이터에서
 * 생성·검증한다. 대피시설 위치는 정적 지리 데이터이므로 실시간 API 대신 내장 JSON +
 * Haversine 최근접 계산을 쓴다 (ADR-004 무장애 원칙 — 네트워크·키 불필요, medical.ts와 동일).
 *
 * 계산량: 관광지 1곳당 시설 702곳 순회(순수 산술) — contentId 기반 메모이즈.
 */
import sheltersJson from "@/data/shelters.gangwon.json";
import { haversineKm } from "@/lib/reco/distance";

interface Shelter {
  name: string;
  lat: number;
  lng: number;
  sigunguCode?: number;
  source: string;
}

/** 로드 시 1회 정합성 필터 — 파일 손상 시 빈 배열이 되고 호출부는 축을 비활성 유지한다 */
const SHELTERS: Shelter[] = (Array.isArray(sheltersJson) ? (sheltersJson as Shelter[]) : []).filter(
  (s) => Number.isFinite(s?.lat) && Number.isFinite(s?.lng),
);

/** contentId → 최근접 거리 메모 — 관광지 좌표는 불변이므로 무기한 유효 */
const memo = new Map<number, number>();

/**
 * 최근접 민방위 대피시설까지 거리(km).
 * 데이터가 비어 있으면 Infinity를 반환하므로
 * 호출부는 Number.isFinite로 축 활성 여부를 판단한다.
 */
export function nearestShelterKm(lat: number, lng: number, contentId?: number): number {
  if (contentId !== undefined && memo.has(contentId)) {
    return memo.get(contentId)!;
  }
  let min = Infinity;
  for (const s of SHELTERS) {
    const d = haversineKm(lat, lng, s.lat, s.lng);
    if (d < min) min = d;
  }
  if (contentId !== undefined) memo.set(contentId, min);
  return min;
}

/** 출처 표기 — UI 각주용 */
export function shelterDataSource(): string {
  return "행정안전부 전국민방위대피시설표준데이터(공공데이터포털)";
}
