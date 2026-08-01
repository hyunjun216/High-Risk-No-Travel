/**
 * 출발 전 체크 리포트 — 준비물 체크리스트 규칙 (제안서 기능 ⑤).
 *
 * 위험 입력값(RiskInput)·환경 유형·동행 프로필로 준비물 문구를 생성한다.
 * 각 규칙의 발동 경계는 안전 점수 엔진의 "감점 시작점"(src/lib/safety/weights.ts)과
 * 일치시킨다 — 리포트에서 감점이 보이는 요인에는 반드시 대응 준비물이 있어야 한다.
 * (감점 시작점보다 높은 임계는 강화 문구에만 사용)
 */
import type { Profile, RiskFactorKey, RiskInput } from "@/lib/safety/types";
import type { Place } from "@/lib/tour/types";
import {
  CHECKLIST_FIRE_LEVEL,
  HEAT,
  MEDICAL,
  PM25,
  RAIN_WIND,
} from "@/lib/safety/weights";

export function buildChecklist(
  input: RiskInput,
  place: Pick<Place, "envType">,
  profile: Profile,
): string[] {
  const items: string[] = [];

  // 폭염 — 감점 시작점(28℃)부터 기본 준비물, 주의보(33℃)부터 아이 강화 문구
  if (input.tempC >= HEAT.RAMP_START_C) {
    items.push("생수·모자·자외선 차단제 챙기기");
    if (profile === "with_kids" && input.tempC >= HEAT.ADVISORY_C) {
      items.push("아이 컨디션(더위 먹음 신호) 자주 확인하기");
    }
  }

  // 강수 — 감점 시작점(30%)부터 우산, 60% 이상 수변형은 급류 경고 강화
  if (input.rainProbPct >= RAIN_WIND.PROB_LOW_PCT) {
    items.push("우산·우비 준비하기");
    if (
      place.envType === "outdoor_water" &&
      input.rainProbPct >= RAIN_WIND.PROB_MID_PCT
    ) {
      items.push("계곡 수위 변화 주의 — 상류 호우 시 즉시 대피");
    }
  }

  // 강풍 — 감점 시작점(9m/s)부터 기본, 산악/해안은 강화 문구
  if (input.windMs !== undefined && input.windMs >= RAIN_WIND.WIND_CAUTION_MS) {
    if (
      place.envType === "outdoor_mountain" ||
      place.envType === "outdoor_coast"
    ) {
      items.push("바람막이 준비, 전망대·능선 구간 주의하기");
    } else {
      items.push("바람에 날리기 쉬운 물품 고정, 겉옷 준비하기");
    }
  }

  // 미세먼지 — 감점 시작점('보통', 16㎍/㎥ 초과)부터 마스크, '나쁨'부터 아이 강화 문구
  if (input.pm25 > PM25.GOOD_MAX) {
    items.push("보건용 마스크(KF80 이상) 챙기기");
    if (profile === "with_kids" && input.pm25 > PM25.MODERATE_MAX) {
      items.push("아이 야외 활동 시간 줄이고 마스크 착용 챙기기");
    }
  }

  // 응급의료 — 감점 시작점(10km 초과)부터 상비약, 부모님 동반 강화 문구
  if (input.emergencyRoomKm > MEDICAL.NEAR_KM) {
    items.push("상비약 지참, 이동 경로의 병원 위치 확인하기");
    if (profile === "with_seniors") {
      items.push("부모님 평소 복용약 챙기기");
    }
  }

  // 산불위험 — 감점 시작점(2단계)부터 주의 문구, 3단계(높음)부터 강화 문구
  if (input.forestFireLevel >= CHECKLIST_FIRE_LEVEL) {
    items.push("산림 인접지 화기 사용 금지, 입산 통제 구간 확인하기");
  } else if (input.forestFireLevel >= 2) {
    items.push("건조한 시기 — 산림 인접지에서 화기 취급 주의하기");
  }

  // 항상 포함
  items.push("출발 전 기상특보 확인하기(기상청)");
  items.push("여행 일정 가족·지인과 공유하기");

  return items;
}

/**
 * 계획(여러 스톱·여러 날짜) 준비물 체크리스트 — 진단 결과의 "감점 요인"으로 생성한다.
 * buildChecklist는 오늘의 RiskInput 원값 기준이라 미래 일차(예보·계절 통계)에는 못 쓰고,
 * 계획 리포트는 이미 날짜별로 계산된 요인(points > 0)을 근거로 같은 취지의 문구를 모은다.
 * 문구는 buildChecklist와 동일하게 유지한다 (같은 요인 = 같은 준비물).
 *
 * heat 키는 TCI 열쾌적이라 겨울 추위 감점도 heat로 나온다 — 체감온도 값으로
 * 더위(RAMP_START_C 이상)/추위(COOL_MAX_C 이하)를 갈라 준비물을 나눈다.
 */
export interface PlanChecklistStop {
  riskFactors: { key: RiskFactorKey; value: number }[];
  envType: Place["envType"];
}

/** 이 온도 이하의 열쾌적 감점은 추위 쪽 — 방한 준비물 (ASHRAE 쾌적 하한 근사) */
const THERMAL_COOL_MAX_C = 10;

export function buildPlanChecklist(
  stops: PlanChecklistStop[],
  profile: Profile,
): string[] {
  const has = (
    key: RiskFactorKey,
    env?: Place["envType"][],
    valueTest?: (v: number) => boolean,
  ) =>
    stops.some(
      (s) =>
        s.riskFactors.some(
          (f) => f.key === key && (valueTest === undefined || valueTest(f.value)),
        ) &&
        (env === undefined || env.includes(s.envType)),
    );
  const withKids = profile === "with_kids" || profile === "with_kids_seniors";
  const withSeniors =
    profile === "with_seniors" || profile === "with_kids_seniors";

  const items: string[] = [];

  if (has("heat", undefined, (v) => v >= HEAT.RAMP_START_C)) {
    items.push("생수·모자·자외선 차단제 챙기기");
    if (withKids) items.push("아이 컨디션(더위 먹음 신호) 자주 확인하기");
  }
  if (has("cold") || has("heat", undefined, (v) => v <= THERMAL_COOL_MAX_C)) {
    items.push("방한복·핫팩 등 한파 대비하기");
  }
  if (has("rain") || has("heavy_rain")) {
    items.push("우산·우비 준비하기");
    if (has("rain", ["outdoor_water"]) || has("heavy_rain", ["outdoor_water"])) {
      items.push("계곡 수위 변화 주의 — 상류 호우 시 즉시 대피");
    }
  }
  if (has("wind")) {
    if (has("wind", ["outdoor_mountain", "outdoor_coast"])) {
      items.push("바람막이 준비, 전망대·능선 구간 주의하기");
    } else {
      items.push("바람에 날리기 쉬운 물품 고정, 겉옷 준비하기");
    }
  }
  if (has("pm")) {
    items.push("보건용 마스크(KF80 이상) 챙기기");
    if (withKids) items.push("아이 야외 활동 시간 줄이고 마스크 착용 챙기기");
  }
  if (has("medical")) {
    items.push("상비약 지참, 이동 경로의 병원 위치 확인하기");
    if (withSeniors) items.push("부모님 평소 복용약 챙기기");
  }
  if (has("forest_fire")) {
    items.push("산림 인접지 화기 사용 금지, 입산 통제 구간 확인하기");
  }
  if (has("landslide")) {
    items.push("산사태 예보·입산 통제 확인, 산악·계곡 구간 우회 대비하기");
  }

  items.push("출발 전 기상특보 확인하기(기상청)");
  items.push("여행 일정 가족·지인과 공유하기");

  return items;
}
