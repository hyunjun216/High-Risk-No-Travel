import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTtlCache } from "./cache";

/** 마이크로태스크 큐 비우기 — 백그라운드 갱신 프로미스 정착 대기 (fake timer 호환) */
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("createTtlCache — 기본 동작", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("TTL 내 같은 키는 factory를 다시 부르지 않는다", async () => {
    const cache = createTtlCache<number>(1000, 100);
    const factory = vi.fn(async () => 1);
    await cache.get("k", factory);
    await cache.get("k", factory);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("동시 요청은 하나의 호출로 합쳐진다", async () => {
    const cache = createTtlCache<number>(1000, 100);
    const factory = vi.fn(async () => 7);
    const [a, b] = await Promise.all([
      cache.get("k", factory),
      cache.get("k", factory),
    ]);
    expect(a).toBe(7);
    expect(b).toBe(7);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("실패 프로미스는 failTtl 내 재사용, 이후에도 블로킹 없이 백그라운드 재시도한다", async () => {
    const cache = createTtlCache<number>(1000, 100);
    let calls = 0;
    const factory = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("down");
      return 2;
    });
    await expect(cache.get("k", factory)).rejects.toThrow("down");
    // failTtl(100ms) 내 — 거부된 프로미스 재사용 (재시도 폭주 방지)
    await expect(cache.get("k", factory)).rejects.toThrow("down");
    expect(factory).toHaveBeenCalledTimes(1);
    // failTtl 경과 — 거부 프로미스를 즉시 반환(동기 대기 없음) + 백그라운드 재시도
    vi.advanceTimersByTime(150);
    await expect(cache.get("k", factory)).rejects.toThrow("down");
    expect(factory).toHaveBeenCalledTimes(2); // 백그라운드 재시도 시작됨
    await flush();
    // 재시도 성공 → 다음 get부터 새 값
    await expect(cache.get("k", factory)).resolves.toBe(2);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

describe("createTtlCache — SWR(만료 시 스테일 반환 + 백그라운드 갱신)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("TTL 만료 후 get은 블로킹 없이 스테일 값을 즉시 반환한다", async () => {
    const cache = createTtlCache<number>(1000, 100);
    let value = 1;
    const factory = vi.fn(async () => value);
    await cache.get("k", factory);

    vi.advanceTimersByTime(1500); // TTL 만료
    value = 2;
    // 갱신이 아무리 느려도(여기선 pending) 스테일 1을 즉시 받는다
    await expect(cache.get("k", factory)).resolves.toBe(1);
    expect(factory).toHaveBeenCalledTimes(2); // 백그라운드 갱신은 시작됨
  });

  it("백그라운드 갱신 완료 후 다음 get은 새 값을 받는다", async () => {
    const cache = createTtlCache<number>(1000, 100);
    let value = 1;
    const factory = vi.fn(async () => value);
    await cache.get("k", factory);

    vi.advanceTimersByTime(1500);
    value = 2;
    await cache.get("k", factory); // 스테일 1 + 갱신 시작
    await flush();
    await expect(cache.get("k", factory)).resolves.toBe(2);
  });

  it("만료 후 연속 get이 백그라운드 갱신을 중복 실행하지 않는다", async () => {
    const cache = createTtlCache<number>(1000, 100);
    const factory = vi.fn(async () => 1);
    await cache.get("k", factory);

    vi.advanceTimersByTime(1500);
    await cache.get("k", factory);
    await cache.get("k", factory);
    await cache.get("k", factory);
    expect(factory).toHaveBeenCalledTimes(2); // 최초 1 + 갱신 1
  });

  it("백그라운드 갱신 실패 시 스테일을 유지하고 다음 get에서 재시도한다", async () => {
    const cache = createTtlCache<number>(1000, 100);
    let calls = 0;
    const factory = vi.fn(async () => {
      calls++;
      if (calls === 2) throw new Error("refresh down");
      return calls;
    });
    await cache.get("k", factory); // 1 저장

    vi.advanceTimersByTime(1500);
    await expect(cache.get("k", factory)).resolves.toBe(1); // 스테일 + 갱신(실패)
    await flush();
    // 갱신이 실패했으므로 여전히 스테일 1 — 그리고 재시도가 다시 시작된다
    await expect(cache.get("k", factory)).resolves.toBe(1);
    await flush();
    // 세 번째 factory 호출(calls=3)은 성공 → 새 값 반영
    await expect(cache.get("k", factory)).resolves.toBe(3);
  });
});
