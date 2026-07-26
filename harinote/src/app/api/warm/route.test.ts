import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 실제 데이터 파이프라인(datasource → live API)을 타지 않도록 mock
vi.mock("@/lib/risk/region-summary", () => ({
  getRegionSummaries: vi.fn(async () => [
    { sigunguCode: 13, name: "춘천시", medianScore: 80 },
  ]),
}));

import { GET } from "./route";
import { getRegionSummaries } from "@/lib/risk/region-summary";

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/warm", { headers });
}

describe("GET /api/warm — 캐시 워밍", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("호출하면 시군 요약을 데워 200과 요약 개수를 반환한다", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.warmed).toBe(1);
    expect(getRegionSummaries).toHaveBeenCalledTimes(1);
  });

  it("CRON_SECRET이 설정돼 있으면 Bearer 불일치 요청을 401로 거절한다", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req({ authorization: "Bearer wrong" }))).status).toBe(401);
    expect(getRegionSummaries).not.toHaveBeenCalled();

    const ok = await GET(req({ authorization: "Bearer s3cret" }));
    expect(ok.status).toBe(200);
  });

  it("워밍 실패 시 500과 오류 메시지를 반환한다 (크론 모니터링에서 보이도록)", async () => {
    vi.mocked(getRegionSummaries).mockRejectedValueOnce(new Error("KMA down"));
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("KMA down");
  });
});
