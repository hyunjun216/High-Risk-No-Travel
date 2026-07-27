import { describe, expect, it } from "vitest";
import { courseConditionParts } from "@/components/travel-condition";

describe("courseConditionParts", () => {
  it("기본 프로필은 이동수단만 (transport는 상시 포함)", () => {
    expect(courseConditionParts("default", "transit")).toEqual(["🚌 대중교통"]);
    expect(courseConditionParts("default", "car")).toEqual(["🚗 자차"]);
  });

  it("동행은 비기본일 때만 앞에 붙는다", () => {
    expect(courseConditionParts("with_kids", "transit")).toEqual([
      "🧒 아이 동반",
      "🚌 대중교통",
    ]);
    expect(courseConditionParts("with_seniors", "car")).toEqual([
      "👵 부모님 동반",
      "🚗 자차",
    ]);
    expect(courseConditionParts("with_kids_seniors", "car")).toEqual([
      "🧒 아이 동반",
      "👵 부모님 동반",
      "🚗 자차",
    ]);
  });
});
