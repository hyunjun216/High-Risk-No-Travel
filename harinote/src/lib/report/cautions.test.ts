import { describe, expect, it } from "vitest";
import { buildPlanCautions, type CautionStop } from "@/lib/report/cautions";
import type { Place } from "@/lib/tour/types";

const stop = (
  dateISO: string,
  factors: [string, number][],
  envType: Place["envType"] = "outdoor_general",
  title = "어느 관광지",
): CautionStop => ({
  dateISO,
  title,
  envType,
  riskFactors: factors.map(([key, value]) => ({ key, value })) as never,
});

const joined = (stops: CautionStop[], profile: "default" | "with_kids" | "with_seniors" = "default") =>
  buildPlanCautions(stops, profile)
    .map((c) => c.text)
    .join("\n");

describe("buildPlanCautions", () => {
  // 이 리포트를 받은 사람이 알아야 하는 건 감점이 아니라 "며칠에 무슨 날씨인가"다
  it("점수·감점을 문장에 쓰지 않는다", () => {
    const out = joined([
      stop("2026-08-05", [["rain", 70], ["pm", 52], ["medical", 18.7]]),
    ]);
    expect(out).not.toContain("점");
    expect(out).not.toContain("−");
  });

  it("강수는 날짜와 확률을 말한다", () => {
    const out = joined([stop("2026-08-05", [["rain", 70]])]);
    expect(out).toContain("8월 5일");
    expect(out).toContain("70%");
  });

  it("미세먼지는 환경부 등급 이름으로 말한다", () => {
    const out = joined([stop("2026-08-05", [["pm", 52]])]);
    expect(out).toContain("나쁨");
    expect(out).toContain("52");
  });

  it("응급의료는 가장 먼 스톱을 이름으로 지목한다", () => {
    const out = joined([
      stop("2026-08-05", [["medical", 11.4]], "outdoor_general", "금대계곡"),
      stop("2026-08-06", [["medical", 19.5]], "outdoor_general", "가람리조트"),
    ]);
    expect(out).toContain("가람리조트");
    expect(out).toContain("19.5km");
    expect(out).not.toContain("금대계곡");
  });

  it("같은 요인이 여러 날이면 한 줄로 묶고 날짜를 나열한다", () => {
    const out = buildPlanCautions(
      [stop("2026-08-05", [["rain", 40]]), stop("2026-08-06", [["rain", 70]])],
      "default",
    );
    const rain = out.filter((c) => c.key === "rain");
    expect(rain).toHaveLength(1);
    expect(rain[0].text).toContain("8월 5일·8월 6일");
    // 여러 날이면 가장 나쁜 값으로 말해야 대비가 된다
    expect(rain[0].text).toContain("70%");
  });

  it("날짜가 많으면 '외 N일'로 줄인다", () => {
    const out = joined([
      stop("2026-08-05", [["pm", 40]]),
      stop("2026-08-06", [["pm", 40]]),
      stop("2026-08-07", [["pm", 40]]),
      stop("2026-08-08", [["pm", 40]]),
    ]);
    expect(out).toContain("8월 5일 외 3일");
  });

  // heat 키는 관광기후지수 열쾌적이라 더위와 추위가 같이 들어온다
  it("열쾌적 값이 낮으면 더위가 아니라 쌀쌀함으로 말한다", () => {
    const out = joined([stop("2026-01-10", [["heat", 4]])]);
    expect(out).toContain("쌀쌀");
    expect(out).not.toContain("폭염");
  });

  it("체감온도가 폭염주의보 기준을 넘으면 그렇게 말한다", () => {
    const out = joined([stop("2026-08-05", [["heat", 34.2]])]);
    expect(out).toContain("폭염주의보 수준");
    expect(out).toContain("34.2℃");
  });

  it("한파는 최저기온 기준으로 말한다", () => {
    const out = joined([stop("2026-01-10", [["cold", -16]])]);
    expect(out).toContain("한파경보 수준");
    expect(out).toContain("-16℃");
  });

  it("추위는 가장 낮은 값이 최악이다", () => {
    const out = joined([
      stop("2026-01-10", [["cold", -13]]),
      stop("2026-01-11", [["cold", -18]]),
    ]);
    expect(out).toContain("-18℃");
    expect(out).not.toContain("-13℃");
  });

  it("동행 프로필에 따라 덧붙는 안내가 달라진다", () => {
    const kids = joined([stop("2026-08-05", [["heat", 34]])], "with_kids");
    const base = joined([stop("2026-08-05", [["heat", 34]])]);
    expect(kids).toContain("아이");
    expect(base).not.toContain("아이");
  });

  it("물가 스톱에 비가 예보되면 급류 경고를 따로 붙인다", () => {
    const out = buildPlanCautions(
      [stop("2026-08-05", [["rain", 70]], "outdoor_water")],
      "default",
    );
    expect(out.some((c) => c.key === "water")).toBe(true);
  });

  it("물가가 없으면 급류 경고를 붙이지 않는다", () => {
    const out = buildPlanCautions(
      [stop("2026-08-05", [["rain", 70]], "outdoor_mountain")],
      "default",
    );
    expect(out.some((c) => c.key === "water")).toBe(false);
  });

  it("비 확률이 낮으면 물가여도 급류 경고는 없다", () => {
    const out = buildPlanCautions(
      [stop("2026-08-05", [["rain", 35]], "outdoor_water")],
      "default",
    );
    expect(out.some((c) => c.key === "water")).toBe(false);
  });

  it("위험이 큰 것부터 위에 온다", () => {
    const out = buildPlanCautions(
      [stop("2026-08-05", [["pm", 40], ["landslide", 2], ["rain", 70]])],
      "default",
    );
    expect(out[0].key).toBe("landslide");
  });

  it("일조(흐림)는 주의할 점이 아니다", () => {
    const out = buildPlanCautions(
      [stop("2026-08-05", [["sun", 2]])],
      "default",
    );
    expect(out).toEqual([]);
  });

  it("감점 요인이 없으면 빈 배열 — 화면이 빈 제목만 그리지 않게", () => {
    expect(buildPlanCautions([stop("2026-08-05", [])], "default")).toEqual([]);
  });

  // 엔진은 쾌적 감점도 요인으로 내보낸다. 그대로 옮기면 "바람 2.6m/s로 강한 편"이라는
  // 거짓 경고가 되고, 진짜 위험한 줄까지 같이 값싸진다.
  describe("경고할 만한 세기부터만 말한다", () => {
    it("산들바람은 주의할 점이 아니다", () => {
      const weak = buildPlanCautions([stop("2026-08-05", [["wind", 2.6]])], "default");
      const strong = buildPlanCautions([stop("2026-08-05", [["wind", 9]])], "default");
      expect(weak.some((c) => c.key === "wind")).toBe(false);
      expect(strong.some((c) => c.key === "wind")).toBe(true);
    });

    it("미세먼지 '보통'은 주의할 점이 아니다 — '나쁨'부터", () => {
      const ok = buildPlanCautions([stop("2026-08-05", [["pm", 21]])], "default");
      const bad = buildPlanCautions([stop("2026-08-05", [["pm", 40]])], "default");
      expect(ok.some((c) => c.key === "pm")).toBe(false);
      expect(bad.some((c) => c.key === "pm")).toBe(true);
    });

    it("약한 값만 있는 날은 그 요인의 날짜에서도 빠진다", () => {
      const out = buildPlanCautions(
        [stop("2026-08-05", [["pm", 21]]), stop("2026-08-06", [["pm", 40]])],
        "default",
      );
      const pm = out.find((c) => c.key === "pm");
      expect(pm?.text).toContain("8월 6일");
      expect(pm?.text).not.toContain("8월 5일");
    });
  });

  it("같은 요인이 두 줄로 나오지 않는다", () => {
    const out = buildPlanCautions(
      [
        stop("2026-08-05", [["rain", 70], ["pm", 40]], "outdoor_water"),
        stop("2026-08-05", [["rain", 80], ["pm", 60]], "outdoor_water"),
      ],
      "default",
    );
    expect(new Set(out.map((c) => c.key)).size).toBe(out.length);
  });
});
