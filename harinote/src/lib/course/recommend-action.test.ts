import { describe, expect, it, vi } from "vitest";

// 데이터 파이프라인을 타지 않도록 mock — 검증 로직만 본다
vi.mock("@/lib/datasource", () => ({
  getPlacesWithSafety: vi.fn(async () => []),
  getPlacesWithSafetyOnDate: vi.fn(async () => []),
}));

import { recommendCourses } from "./recommend-action";
import { getPlacesWithSafety, getPlacesWithSafetyOnDate } from "@/lib/datasource";

describe("recommendCourses — 공개 엔드포인트 입력 검증", () => {
  it("프로토타입 체인 키(constructor 등)를 거부한다", async () => {
    // `in` 연산자였다면 통과해 PROFILE_WEIGHT[profile]=Object 생성자 → NaN 점수
    await expect(
      recommendCourses(13, "constructor" as never),
    ).rejects.toThrow("잘못된 요청");
    await expect(
      recommendCourses(13, "toString" as never),
    ).rejects.toThrow("잘못된 요청");
    await expect(
      recommendCourses("constructor" as never, "default"),
    ).rejects.toThrow("잘못된 요청");
  });

  it("정상 시군·프로필은 통과한다", async () => {
    await expect(recommendCourses(13, "default")).resolves.toBeDefined();
  });

  it("유효한 날짜는 그 날짜 점수로, 무효 날짜는 오늘 점수로 계산한다", async () => {
    vi.mocked(getPlacesWithSafetyOnDate).mockClear();
    vi.mocked(getPlacesWithSafety).mockClear();

    // 내일 (parseDate 허용 범위) — 실제 날짜에 의존하지 않게 동적 생성
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await recommendCourses(13, "default", tomorrow);
    expect(getPlacesWithSafetyOnDate).toHaveBeenCalledWith("default", tomorrow);

    // 형식 오류·과거 날짜 → 오늘 모드 폴백 (throw 아님 — 링크 진입 UX 보호)
    await recommendCourses(13, "default", "9999-99-99");
    await recommendCourses(13, "default", "2000-01-01");
    expect(getPlacesWithSafety).toHaveBeenCalledTimes(2);
  });
});
