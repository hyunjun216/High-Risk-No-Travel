import { afterEach, describe, expect, it, vi } from "vitest";
import { apparentTempSummerC } from "@/lib/risk/apparent-temp";
import { KMA_MAX_CONCURRENT, fetchKmaDailyWeather, parsePcp, pickBaseDateTime, summarizeDaily } from "@/lib/risk/kma";

/** KST 시각 문자열로 Date 생성 — 테스트 머신 타임존에 무관 */
function kst(iso: string): Date {
  return new Date(`${iso}+09:00`);
}

describe("pickBaseDateTime (Asia/Seoul 기준)", () => {
  it("KST 03:00 → 당일 02시 발표", () => {
    expect(pickBaseDateTime(kst("2026-07-03T03:00:00"))).toEqual({
      baseDate: "20260703",
      baseTime: "0200",
    });
  });

  it("KST 05:05 → 05시 발표 반영 전이므로 02시 발표", () => {
    expect(pickBaseDateTime(kst("2026-07-03T05:05:00"))).toEqual({
      baseDate: "20260703",
      baseTime: "0200",
    });
  });

  it("KST 05:15 → 05시 발표", () => {
    expect(pickBaseDateTime(kst("2026-07-03T05:15:00"))).toEqual({
      baseDate: "20260703",
      baseTime: "0500",
    });
  });

  it("KST 00:30 → 전날 23시 발표", () => {
    expect(pickBaseDateTime(kst("2026-07-03T00:30:00"))).toEqual({
      baseDate: "20260702",
      baseTime: "2300",
    });
  });

  it("KST 02:09 → 아직 02시 미반영, 전날 23시 발표", () => {
    expect(pickBaseDateTime(kst("2026-07-03T02:09:00"))).toEqual({
      baseDate: "20260702",
      baseTime: "2300",
    });
  });

  it("KST 02:10 → 당일 02시 발표", () => {
    expect(pickBaseDateTime(kst("2026-07-03T02:10:00"))).toEqual({
      baseDate: "20260703",
      baseTime: "0200",
    });
  });

  it("KST 23:59 → 20시 발표 유지 (23시 발표는 내일 예보라 '오늘' 요약에 부적합)", () => {
    expect(pickBaseDateTime(kst("2026-07-03T23:59:00"))).toEqual({
      baseDate: "20260703",
      baseTime: "2000",
    });
  });

  it("월 경계: KST 7/1 00:30 → 6/30 23시 발표", () => {
    expect(pickBaseDateTime(kst("2026-07-01T00:30:00"))).toEqual({
      baseDate: "20260630",
      baseTime: "2300",
    });
  });
});

describe("parsePcp (강수량 문자열 파싱)", () => {
  it('"강수없음" → undefined', () => {
    expect(parsePcp("강수없음")).toBeUndefined();
  });

  it('"1mm 미만" → 0.5', () => {
    expect(parsePcp("1mm 미만")).toBe(0.5);
    expect(parsePcp("1.0mm 미만")).toBe(0.5);
  });

  it('"1.0mm" → 1', () => {
    expect(parsePcp("1.0mm")).toBe(1);
  });

  it('"30.0~50.0mm" → 중간값 40', () => {
    expect(parsePcp("30.0~50.0mm")).toBe(40);
  });

  it('"50.0mm 이상" → 50', () => {
    expect(parsePcp("50.0mm 이상")).toBe(50);
  });

  it('"-"·null·빈 문자열 → undefined', () => {
    expect(parsePcp("-")).toBeUndefined();
    expect(parsePcp(null)).toBeUndefined();
    expect(parsePcp("")).toBeUndefined();
  });
});

describe("summarizeDaily", () => {
  const item = (category: string, fcstValue: string, fcstDate = "20260703", fcstTime = "1200") => ({
    category,
    fcstDate,
    fcstTime,
    fcstValue,
  });

  it("TMX 우선, POP·WSD 최댓값, PCP 합계", () => {
    const items = [
      item("TMP", "28"),
      item("TMP", "31", "20260703", "1500"),
      item("TMX", "33.0", "20260703", "1500"),
      item("POP", "30"),
      item("POP", "80", "20260703", "1800"),
      item("WSD", "3.5"),
      item("WSD", "7.2", "20260703", "1800"),
      item("PCP", "강수없음"),
      item("PCP", "5.0mm", "20260703", "1500"),
      item("PCP", "30.0~50.0mm", "20260703", "1800"),
    ];
    expect(summarizeDaily(items, "20260703")).toEqual({
      tempC: 33,
      tminC: 28, // TMN 없음 → 남은 시간대 TMP 최솟값
      rainProbPct: 80,
      windMs: 7.2,
      rainMm: 45, // 5.0mm + 범위 중간값 40
    });
  });

  it("TMX가 없으면 남은 시간대 TMP 최댓값", () => {
    const items = [item("TMP", "24"), item("TMP", "27", "20260703", "1600")];
    expect(summarizeDaily(items, "20260703").tempC).toBe(27);
  });

  it("TMN이 있으면 tminC는 TMN — TMP 최솟값보다 우선", () => {
    const items = [
      item("TMN", "-11.0", "20260115", "0600"),
      item("TMP", "-3", "20260115", "1200"),
      item("TMP", "-7", "20260115", "2100"),
    ];
    // TMP 최솟값(-7)이 아니라 아침 최저(TMN -11)가 한파 축 입력이 된다
    expect(summarizeDaily(items, "20260115").tminC).toBe(-11);
  });

  it("TMN이 없으면(오늘 오후 조회) 남은 시간대 TMP 최솟값", () => {
    const items = [
      item("TMP", "-3", "20260115", "1500"),
      item("TMP", "-7", "20260115", "2100"),
    ];
    // 아침 최저는 이미 지나 예보에 없다 — "지금부터 겪을 최저"로 대체
    expect(summarizeDaily(items, "20260115").tminC).toBe(-7);
  });

  it("기온 항목이 하나도 없으면 tminC는 undefined", () => {
    const items = [item("POP", "40"), item("WSD", "2.0")];
    expect(summarizeDaily(items, "20260703").tminC).toBeUndefined();
  });

  it("전부 강수없음이면 rainMm은 undefined", () => {
    const items = [item("PCP", "강수없음"), item("POP", "10")];
    expect(summarizeDaily(items, "20260703").rainMm).toBeUndefined();
  });

  it("오늘 예보가 없으면(자정 직전 23시 발표) 가장 이른 예보일로 대체", () => {
    const items = [
      item("TMP", "22", "20260704", "0000"),
      item("TMX", "30.0", "20260704", "1500"),
      item("TMP", "25", "20260705", "1200"),
    ];
    expect(summarizeDaily(items, "20260703").tempC).toBe(30);
  });

  it("TMP·REH 쌍이 있으면 apparentTempC는 시간별 체감온도의 최댓값", () => {
    const items = [
      item("TMP", "29", "20260703", "1200"),
      item("REH", "70", "20260703", "1200"),
      item("TMP", "31", "20260703", "1500"),
      item("REH", "80", "20260703", "1500"),
    ];
    const w = summarizeDaily(items, "20260703");
    // 최댓값은 15시 쌍(31℃×80%) — 폭염주의보 상황이면 33℃ 이상
    expect(w.apparentTempC).toBe(apparentTempSummerC(31, 80));
    expect(w.apparentTempC!).toBeGreaterThanOrEqual(33);
    // 기존 필드는 그대로 (tempC는 TMP 최댓값)
    expect(w.tempC).toBe(31);
  });

  it("REH가 없으면 apparentTempC는 undefined", () => {
    const items = [item("TMP", "31"), item("TMX", "33.0", "20260703", "1500")];
    expect(summarizeDaily(items, "20260703").apparentTempC).toBeUndefined();
  });

  it("TMP·REH 시각이 어긋나면 짝지어진 시각만 사용", () => {
    const items = [
      item("TMP", "33", "20260703", "1200"), // REH 없음 — 체감온도 계산에서 제외
      item("TMP", "29", "20260703", "1500"),
      item("REH", "70", "20260703", "1500"),
      item("REH", "90", "20260703", "1800"), // TMP 없음 — 제외
    ];
    const w = summarizeDaily(items, "20260703");
    expect(w.apparentTempC).toBe(apparentTempSummerC(29, 70));
    // 12시 TMP 33℃가 최고기온이지만 체감온도에는 반영되지 않는다
    expect(w.tempC).toBe(33);
  });

  it("미래 날짜 조회(fallback 끔): 해당 날짜가 없으면 빈 요약 — 계절모드 폴백 신호", () => {
    const items = [item("TMX", "30.0", "20260704", "1500")];
    expect(summarizeDaily(items, "20260707", false)).toEqual({});
    // 해당 날짜가 있으면 정상 요약
    expect(summarizeDaily(items, "20260704", false).tempC).toBe(30);
  });

  it("여름철(5~9월) 밖에서는 apparentTempC를 계산하지 않는다 — 겨울 산식 오적용 방지", () => {
    const items = [
      item("TMP", "0", "20260115", "1200"),
      item("REH", "80", "20260115", "1200"),
      item("TMP", "2", "20260115", "1500"),
      item("REH", "70", "20260115", "1500"),
    ];
    const w = summarizeDaily(items, "20260115");
    expect(w.apparentTempC).toBeUndefined();
    expect(w.tempC).toBe(2); // 건구기온 요약은 그대로
  });

  it("강수확률은 활동시간대(09~20시) 최댓값 — 새벽 소나기가 낮 쾌적을 깎지 않는다", () => {
    const items = [
      item("POP", "70", "20260703", "0300"), // 여행자가 자는 시간
      item("POP", "20", "20260703", "1200"),
      item("TMP", "28"),
    ];
    expect(summarizeDaily(items, "20260703").rainProbPct).toBe(20);
  });

  it("풍속도 같은 창 — 밤바람은 쾌적 감점에서 제외", () => {
    const items = [
      item("WSD", "9.0", "20260703", "2300"),
      item("WSD", "3.0", "20260703", "1200"),
      item("TMP", "28"),
    ];
    expect(summarizeDaily(items, "20260703").windMs).toBe(3.0);
  });

  it("활동시간대 경계(0900·2000)는 창에 포함한다", () => {
    const items = [
      item("POP", "40", "20260703", "0900"),
      item("POP", "50", "20260703", "2000"),
      item("POP", "90", "20260703", "2100"), // 창 밖
    ];
    expect(summarizeDaily(items, "20260703").rainProbPct).toBe(50);
  });

  it("창 안 데이터가 없으면(저녁 조회) 하루 전체로 폴백 — mock 값 혼입 방지", () => {
    // 21시에 "오늘"을 조회하면 활동시간대는 이미 지나 응답에 남지 않는다.
    // undefined를 돌려주면 필수 필드(rainProbPct)가 mock 값으로 남아 실측과 섞인다.
    const items = [
      item("POP", "60", "20260703", "2100"),
      item("WSD", "8.0", "20260703", "2200"),
      item("TMP", "24", "20260703", "2100"),
    ];
    const w = summarizeDaily(items, "20260703");
    expect(w.rainProbPct).toBe(60);
    expect(w.windMs).toBe(8.0);
  });

  it("강수량 누적은 창과 무관하게 하루 전체 — 안전층(호우·산사태) 입력", () => {
    const items = [
      item("PCP", "40.0mm", "20260703", "0300"), // 새벽 호우
      item("PCP", "강수없음", "20260703", "1200"),
      item("POP", "20", "20260703", "1200"),
    ];
    const w = summarizeDaily(items, "20260703");
    expect(w.rainMm).toBe(40);
    expect(w.rainProbPct).toBe(20); // 쾌적층 확률만 창 적용
  });

  it("미래 날짜 조회: 오전 예보만 남은 반쪽 응답이면 빈 요약 — 최고기온 과소평가 방지", () => {
    // TMX 없고 TMP도 15시 이전뿐 (응답 절단으로 하루 중간에서 끊긴 상황)
    const truncated = [
      item("TMP", "25", "20260705", "0600"),
      item("TMP", "28", "20260705", "1000"),
      item("POP", "20", "20260705", "0900"),
    ];
    expect(summarizeDaily(truncated, "20260705", false)).toEqual({});
    // 15시 이후 TMP가 있으면 TMX 없이도 정상 요약
    const covered = [...truncated, item("TMP", "31", "20260705", "1500")];
    expect(summarizeDaily(covered, "20260705", false).tempC).toBe(31);
    // 오늘 조회(fallback 켬)는 저녁에 남은 시간대만 있어도 가드를 적용하지 않는다
    expect(summarizeDaily(truncated, "20260705").tempC).toBe(28);
  });
});

describe("KMA_MAX_CONCURRENT — 동시 호출 상한", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("격자를 한꺼번에 요청해도 동시 in-flight가 상한을 넘지 않는다", async () => {
    vi.stubEnv("KMA_API_KEY", "test-kma-key");

    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return new Response(
          JSON.stringify({
            response: { header: { resultCode: "00" }, body: { items: { item: [] } } },
          }),
          { status: 200 },
        );
      }),
    );

    // 서로 다른 격자 60개를 동시에 — 실제 홈 렌더(149격자)의 축소판
    await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        fetchKmaDailyWeather(60 + (i % 10), 125 + Math.floor(i / 10)),
      ),
    );

    expect(peak).toBeLessThanOrEqual(KMA_MAX_CONCURRENT);
    expect(peak).toBeGreaterThan(1); // 직렬화까지 가면 안 된다
  });
});
