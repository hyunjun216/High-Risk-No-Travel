import { describe, expect, it, vi } from "vitest";
import { shareOrCopy } from "./report-share";

const DATA = { title: "강원 2박3일 계획 리포트", url: "https://hari.example/plans/report?s=1.1" };

/** 공유 시트를 닫았을 때 브라우저가 던지는 것과 같은 모양 */
function abortError(): Error {
  const e = new Error("Share canceled");
  e.name = "AbortError";
  return e;
}

describe("shareOrCopy", () => {
  it("공유 시트를 쓸 수 있으면 그쪽으로 보내고 복사하지 않는다", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const copy = vi.fn().mockResolvedValue(undefined);

    expect(await shareOrCopy(DATA, { share, copy })).toBe("shared");
    expect(share).toHaveBeenCalledWith(DATA);
    expect(copy).not.toHaveBeenCalled();
  });

  it("공유 미지원 브라우저면 링크를 복사한다", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);

    expect(await shareOrCopy(DATA, { copy })).toBe("copied");
    expect(copy).toHaveBeenCalledWith(DATA.url);
  });

  // 취소한 사람에게 말없이 클립보드를 덮어쓰면 "공유를 그만뒀는데 왜 복사됐지"가 된다.
  it("사용자가 공유 시트를 닫으면 복사로 이어가지 않는다", async () => {
    const share = vi.fn().mockRejectedValue(abortError());
    const copy = vi.fn().mockResolvedValue(undefined);

    expect(await shareOrCopy(DATA, { share, copy })).toBe("cancelled");
    expect(copy).not.toHaveBeenCalled();
  });

  it("취소가 아닌 이유로 공유가 실패하면 복사로 떨어진다", async () => {
    const share = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    const copy = vi.fn().mockResolvedValue(undefined);

    expect(await shareOrCopy(DATA, { share, copy })).toBe("copied");
    expect(copy).toHaveBeenCalledWith(DATA.url);
  });

  it("클립보드까지 막히면 failed — 호출부가 '복사됨' 거짓 표시를 막을 수 있게", async () => {
    const copy = vi.fn().mockRejectedValue(new Error("denied"));

    expect(await shareOrCopy(DATA, { copy })).toBe("failed");
  });

  // navigator.clipboard 자체가 없는 환경에서는 deps.copy가 동기 TypeError를 던진다
  it("클립보드 접근이 동기로 터져도 삼킨다", async () => {
    const copy = vi.fn(() => {
      throw new TypeError("Cannot read properties of undefined");
    });

    expect(await shareOrCopy(DATA, { copy })).toBe("failed");
  });
});
