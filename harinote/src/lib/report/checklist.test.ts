import { describe, expect, it } from "vitest";
import type { RiskInput } from "@/lib/safety/types";
import type { PlaceEnvType } from "@/lib/tour/types";
import { buildChecklist, buildPlanChecklist } from "@/lib/report/checklist";

/** 어떤 규칙도 발동하지 않는 기준 입력 */
function calmInput(overrides: Partial<RiskInput> = {}): RiskInput {
  return {
    tempC: 22,
    rainProbPct: 10,
    windMs: 2,
    pm25: 10,
    forestFireLevel: 1,
    emergencyRoomKm: 3,
    ...overrides,
  };
}

function envPlace(envType: PlaceEnvType = "outdoor_general") {
  return { envType };
}

describe("buildChecklist — 항상 포함 항목", () => {
  it("규칙이 하나도 발동하지 않으면 상시 항목 2개만 반환한다", () => {
    const items = buildChecklist(calmInput(), envPlace(), "default");
    expect(items).toEqual([
      "출발 전 기상특보 확인하기(기상청)",
      "여행 일정 가족·지인과 공유하기",
    ]);
  });
});

describe("buildChecklist — 한파", () => {
  const COLD_ITEM = "방한복·핫팩 등 한파 대비하기";

  it("최저기온이 감점 시작점(-5℃) 이하면 방한 항목이 생긴다", () => {
    const items = buildChecklist(
      calmInput({ tempC: 15, tminC: -6 }),
      envPlace(),
      "default",
    );
    expect(items).toContain(COLD_ITEM);
  });

  it("최저기온이 -5℃를 넘고 낮도 포근하면 방한 항목이 없다", () => {
    const items = buildChecklist(
      calmInput({ tempC: 15, tminC: -4 }),
      envPlace(),
      "default",
    );
    expect(items).not.toContain(COLD_ITEM);
  });

  it("최저기온이 없는 경로(중기예보)는 열쾌적 값으로 판단한다", () => {
    expect(buildChecklist(calmInput({ tempC: 10 }), envPlace(), "default")).toContain(COLD_ITEM);
    expect(buildChecklist(calmInput({ tempC: 11 }), envPlace(), "default")).not.toContain(COLD_ITEM);
  });

  it("한파 감점이 있으면 반드시 대응 준비물이 있다 — 리포트 계약", () => {
    // 상세 리포트는 같은 RiskInput으로 감점 막대와 준비물을 만든다.
    // 막대에 한파가 뜨는데 준비물이 비면 리포트가 자기모순이 된다
    const input = calmInput({ tempC: -2, tminC: -13 });
    expect(buildChecklist(input, envPlace(), "default")).toContain(COLD_ITEM);
  });
});

describe("buildChecklist — 폭염", () => {
  it("감점 시작점(28℃) 미만인 27.9℃는 폭염 항목이 없다", () => {
    const items = buildChecklist(calmInput({ tempC: 27.9 }), envPlace(), "default");
    expect(items.join()).not.toContain("생수");
  });

  it("경계값 33℃부터 생수·모자·자외선 차단제 항목이 생긴다", () => {
    const items = buildChecklist(calmInput({ tempC: 33 }), envPlace(), "default");
    expect(items).toContain("생수·모자·자외선 차단제 챙기기");
  });

  it("아이 동반이면 아이 컨디션 확인 항목이 추가된다", () => {
    const items = buildChecklist(calmInput({ tempC: 34 }), envPlace(), "with_kids");
    expect(items).toContain("아이 컨디션(더위 먹음 신호) 자주 확인하기");
  });

  it("기본 프로필이면 아이 컨디션 항목이 없다", () => {
    const items = buildChecklist(calmInput({ tempC: 34 }), envPlace(), "default");
    expect(items.join()).not.toContain("아이 컨디션");
  });
});

describe("buildChecklist — 강수", () => {
  it("감점 시작점(30%) 미만인 29%는 우산 항목이 없다", () => {
    const items = buildChecklist(calmInput({ rainProbPct: 29 }), envPlace(), "default");
    expect(items.join()).not.toContain("우산");
  });

  it("감점 시작점(30%)부터 우산·우비 항목이 생긴다", () => {
    const items = buildChecklist(calmInput({ rainProbPct: 30 }), envPlace(), "default");
    expect(items).toContain("우산·우비 준비하기");
  });

  it("강수 60%+ 계곡·수변이면 수위 대피 항목이 추가된다", () => {
    const items = buildChecklist(
      calmInput({ rainProbPct: 70 }),
      envPlace("outdoor_water"),
      "default",
    );
    expect(items).toContain("계곡 수위 변화 주의 — 상류 호우 시 즉시 대피");
  });

  it("강수 60%+라도 일반 야외면 수위 항목이 없다", () => {
    const items = buildChecklist(calmInput({ rainProbPct: 70 }), envPlace(), "default");
    expect(items.join()).not.toContain("수위");
  });

  it("계곡·수변이라도 강수확률이 낮으면 수위 항목이 없다", () => {
    const items = buildChecklist(
      calmInput({ rainProbPct: 30 }),
      envPlace("outdoor_water"),
      "default",
    );
    expect(items.join()).not.toContain("수위");
  });
});

describe("buildChecklist — 강풍", () => {
  it("풍속 9m/s + 산악이면 바람막이 항목이 생긴다", () => {
    const items = buildChecklist(
      calmInput({ windMs: 9 }),
      envPlace("outdoor_mountain"),
      "default",
    );
    expect(items).toContain("바람막이 준비, 전망대·능선 구간 주의하기");
  });

  it("풍속 9m/s + 해안도 바람막이 항목이 생긴다", () => {
    const items = buildChecklist(
      calmInput({ windMs: 12 }),
      envPlace("outdoor_coast"),
      "default",
    );
    expect(items.join()).toContain("바람막이");
  });

  it("풍속 8.9m/s는 산악이어도 바람막이 항목이 없다", () => {
    const items = buildChecklist(
      calmInput({ windMs: 8.9 }),
      envPlace("outdoor_mountain"),
      "default",
    );
    expect(items.join()).not.toContain("바람막이");
  });

  it("풍속 9m/s+라도 일반 야외·실내면 바람막이 항목이 없다", () => {
    for (const env of ["outdoor_general", "indoor"] as const) {
      const items = buildChecklist(calmInput({ windMs: 15 }), envPlace(env), "default");
      expect(items.join()).not.toContain("바람막이");
    }
  });
});

describe("buildChecklist — 미세먼지", () => {
  it("감점 시작점('좋음' 상한 15) 이하인 PM2.5 15는 마스크 항목이 없다", () => {
    const items = buildChecklist(calmInput({ pm25: 15 }), envPlace(), "default");
    expect(items.join()).not.toContain("마스크");
  });

  it("감점 시작점('보통', 16)부터 KF80 마스크 항목이 생긴다", () => {
    const items = buildChecklist(calmInput({ pm25: 16 }), envPlace(), "default");
    expect(items).toContain("보건용 마스크(KF80 이상) 챙기기");
  });

  it("아이 동반이면 야외 활동 가중 문구가 추가된다", () => {
    const items = buildChecklist(calmInput({ pm25: 50 }), envPlace(), "with_kids");
    expect(items).toContain("아이 야외 활동 시간 줄이고 마스크 착용 챙기기");
  });
});

describe("buildChecklist — 응급의료", () => {
  it("감점 시작점(10km) 이하인 10.0km는 상비약 항목이 없다", () => {
    const items = buildChecklist(
      calmInput({ emergencyRoomKm: 10.0 }),
      envPlace(),
      "default",
    );
    expect(items.join()).not.toContain("상비약");
  });

  it("경계값 20km부터 상비약·병원 위치 항목이 생긴다", () => {
    const items = buildChecklist(
      calmInput({ emergencyRoomKm: 20 }),
      envPlace(),
      "default",
    );
    expect(items).toContain("상비약 지참, 이동 경로의 병원 위치 확인하기");
  });

  it("부모님 동반이면 복용약 항목이 추가된다", () => {
    const items = buildChecklist(
      calmInput({ emergencyRoomKm: 25 }),
      envPlace(),
      "with_seniors",
    );
    expect(items).toContain("부모님 평소 복용약 챙기기");
  });

  it("기본 프로필이면 복용약 항목이 없다", () => {
    const items = buildChecklist(
      calmInput({ emergencyRoomKm: 25 }),
      envPlace(),
      "default",
    );
    expect(items.join()).not.toContain("복용약");
  });
});

describe("buildChecklist — 산불위험", () => {
  it("2단계는 강화 문구 대신 '취급 주의' 항목이 생긴다", () => {
    const items = buildChecklist(
      calmInput({ forestFireLevel: 2 }),
      envPlace("outdoor_mountain"),
      "default",
    );
    expect(items).toContain("건조한 시기 — 산림 인접지에서 화기 취급 주의하기");
    expect(items.join()).not.toContain("화기 사용 금지");
  });

  it("1단계는 산불 항목이 없다", () => {
    const items = buildChecklist(
      calmInput({ forestFireLevel: 1 }),
      envPlace("outdoor_mountain"),
      "default",
    );
    expect(items.join()).not.toContain("화기");
  });

  it("3단계부터 화기 금지·통제 구간 항목이 생긴다", () => {
    const items = buildChecklist(
      calmInput({ forestFireLevel: 3 }),
      envPlace("outdoor_mountain"),
      "default",
    );
    expect(items).toContain("산림 인접지 화기 사용 금지, 입산 통제 구간 확인하기");
  });
});

describe("buildChecklist — 중복 없음", () => {
  it("모든 규칙이 동시에 발동해도 항목이 중복되지 않는다", () => {
    const extreme = calmInput({
      tempC: 36,
      rainProbPct: 90,
      windMs: 15,
      pm25: 80,
      forestFireLevel: 4,
      emergencyRoomKm: 35,
    });
    for (const profile of ["default", "with_kids", "with_seniors", "with_kids_seniors"] as const) {
      const items = buildChecklist(extreme, envPlace("outdoor_water"), profile);
      expect(new Set(items).size).toBe(items.length);
    }
  });
});

describe("buildPlanChecklist — 계획(요인) 기반", () => {
  const f = (key: string, value: number) => ({ key, value }) as never;
  it("스톱들의 감점 요인 합집합으로 준비물을 만든다", () => {
    const items = buildPlanChecklist(
      [
        { riskFactors: [f("heat", 34), f("pm", 40)], envType: "outdoor_general" },
        { riskFactors: [f("medical", 22)], envType: "outdoor_mountain" },
      ],
      "default",
    );
    expect(items).toContain("생수·모자·자외선 차단제 챙기기");
    expect(items).toContain("보건용 마스크(KF80 이상) 챙기기");
    expect(items).toContain("상비약 지참, 이동 경로의 병원 위치 확인하기");
    expect(items).toContain("출발 전 기상특보 확인하기(기상청)");
  });

  it("열쾌적 감점이 추위 쪽(저온)이면 폭염 대신 방한 준비물", () => {
    const items = buildPlanChecklist(
      [{ riskFactors: [f("heat", -5)], envType: "outdoor_general" }],
      "default",
    );
    expect(items).toContain("방한복·핫팩 등 한파 대비하기");
    expect(items.join()).not.toContain("생수");
  });

  it("수변형 스톱의 강수 요인은 급류 경고를 추가한다", () => {
    const items = buildPlanChecklist(
      [{ riskFactors: [f("rain", 70)], envType: "outdoor_water" }],
      "default",
    );
    expect(items).toContain("계곡 수위 변화 주의 — 상류 호우 시 즉시 대피");
  });

  it("한파·산사태 등 계절 모드 요인도 문구가 있다", () => {
    const items = buildPlanChecklist(
      [{ riskFactors: [f("cold", -15), f("landslide", 2)], envType: "outdoor_mountain" }],
      "default",
    );
    expect(items).toContain("방한복·핫팩 등 한파 대비하기");
    expect(items).toContain("산사태 예보·입산 통제 확인, 산악·계곡 구간 우회 대비하기");
  });

  it("아이·부모님 동반 복합 프로필은 강화 문구를 모두 포함한다", () => {
    const items = buildPlanChecklist(
      [{ riskFactors: [f("heat", 34), f("medical", 25)], envType: "outdoor_general" }],
      "with_kids_seniors",
    );
    expect(items).toContain("아이 컨디션(더위 먹음 신호) 자주 확인하기");
    expect(items).toContain("부모님 평소 복용약 챙기기");
  });

  it("요인이 없으면 상시 항목만", () => {
    const items = buildPlanChecklist(
      [{ riskFactors: [], envType: "indoor" }],
      "default",
    );
    expect(items).toEqual([
      "출발 전 기상특보 확인하기(기상청)",
      "여행 일정 가족·지인과 공유하기",
    ]);
  });

  it("여러 스톱이 같은 요인이어도 중복되지 않는다", () => {
    const all = ["rain", "wind", "pm", "medical", "forest_fire", "landslide"].map(
      (k) => f(k, 50),
    );
    const items = buildPlanChecklist(
      [
        { riskFactors: [...all, f("heat", 34), f("cold", -15)], envType: "outdoor_water" },
        { riskFactors: [...all, f("heat", 34), f("cold", -15)], envType: "outdoor_mountain" },
      ],
      "with_kids_seniors",
    );
    expect(new Set(items).size).toBe(items.length);
  });
});
