import { describe, expect, it } from "vitest";
import { nearestShelterKm, shelterDataSource } from "@/lib/risk/shelter";

describe("nearestShelterKm — 알려진 좌표 합리성", () => {
  it("춘천 시내(시청 인근)는 도보권 — 도심 대피시설 밀집", () => {
    const km = nearestShelterKm(37.8813, 127.7298);
    expect(km).toBeGreaterThan(0);
    expect(km).toBeLessThan(1);
  });

  it("가리왕산 정상 일대는 5km 초과 (최대 감점 구간)", () => {
    const km = nearestShelterKm(37.4635, 128.5605);
    expect(km).toBeGreaterThan(5);
    expect(km).toBeLessThan(35);
  });

  it("점봉산 곰배령(인제 심산)은 도보권 밖 — 감점 구간 (최근접: 진동리 일대 ~4km)", () => {
    const km = nearestShelterKm(38.0489, 128.4253);
    expect(km).toBeGreaterThan(3);
    expect(km).toBeLessThan(10);
  });
});

describe("nearestShelterKm — contentId 메모이즈", () => {
  it("같은 contentId는 좌표가 달라도 캐시값을 돌려준다 (좌표 불변 전제)", () => {
    const contentId = 999_000_002; // 실데이터와 겹치지 않는 테스트 전용 id
    const first = nearestShelterKm(37.8813, 127.7298, contentId);
    const second = nearestShelterKm(37.1641, 128.9856, contentId); // 태백 좌표를 줘도
    expect(second).toBe(first);
  });

  it("contentId 없이 부르면 매번 실계산한다", () => {
    const chuncheon = nearestShelterKm(37.8813, 127.7298);
    const taebaek = nearestShelterKm(37.1641, 128.9856);
    expect(taebaek).not.toBe(chuncheon);
  });
});

describe("shelterDataSource", () => {
  it("UI 각주용 출처 문자열을 반환한다", () => {
    expect(shelterDataSource()).toContain("행정안전부");
  });
});
