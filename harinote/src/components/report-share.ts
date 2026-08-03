/**
 * 리포트 공유 분기 — 순수 로직 (navigator와 분리해 테스트 가능).
 * ReportActions가 이 함수의 결과로 버튼 라벨을 정한다.
 */

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

export interface ShareDeps {
  /** navigator.share — secure context(https/localhost)가 아니거나 미지원이면 undefined */
  share?: (data: { title: string; url: string }) => Promise<void>;
  /** navigator.clipboard.writeText */
  copy: (text: string) => Promise<void>;
}

/** 공유 시트를 사용자가 닫았을 때 브라우저가 던지는 이름 (DOMException) */
function isAbort(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { name?: unknown }).name === "AbortError"
  );
}

/**
 * 공유 시트 → 없거나 실패하면 링크 복사.
 *
 * 취소(AbortError)만은 복사로 이어가지 않는다 — 공유를 닫은 사람에게
 * 아무 말 없이 클립보드를 덮어쓰면 취소한 의도를 뒤집는 셈이 된다.
 */
export async function shareOrCopy(
  data: { title: string; url: string },
  deps: ShareDeps,
): Promise<ShareOutcome> {
  if (deps.share) {
    try {
      await deps.share(data);
      return "shared";
    } catch (e) {
      if (isAbort(e)) return "cancelled";
      // 권한 거부 등 취소가 아닌 실패는 복사로 떨어진다
    }
  }
  try {
    await deps.copy(data.url);
    return "copied";
  } catch {
    // 클립보드까지 막힘 — 주소창에서 직접 복사하도록 둔다
    return "failed";
  }
}
