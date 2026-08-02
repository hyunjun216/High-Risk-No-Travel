/**
 * 안전지도 변별력 측정 — 실행: npx tsx scripts/check-map-spread.ts
 *
 * 시군 choropleth가 "오늘 어느 시군이 더 위험한가"에 답하는지를 숫자로 잰다.
 * 고정 시나리오 5종을 전 관광지(gangwon.json)에 적용해 summarizeRegions로 집계하고,
 * 등급 변별(전 시군 동일 등급인가) · 점수 스프레드 · 시나리오 간 순위 변동을 출력한다.
 *
 * 기상은 시나리오 상수를 쓰므로 네트워크·키 불필요하고 결과가 결정적이다
 * (응급의료·대피소 거리만 내장 좌표로 실계산).
 * 안전점수 축을 손댈 때 변경 전후를 같은 절차로 비교하는 기준선 역할.
 */
import rawPlaces from "../src/data/gangwon.json";
import { applyEnvTypeOverrides } from "../src/lib/tour/env-overrides";
import { computeSafetyScore } from "../src/lib/safety/score";
import { summarizeRegions } from "../src/lib/risk/region-summary";
import { nearestHospitalKm } from "../src/lib/risk/medical";
import { nearestShelterKm } from "../src/lib/risk/shelter";
import type { Place } from "../src/lib/tour/types";
import type { RiskInput } from "../src/lib/safety/types";

/** 강원에서 실제로 반복되는 기상 조건 — 계절별 대표 + 재난 활성 케이스 */
const SCENARIOS: Array<{ name: string; input: RiskInput }> = [
  {
    name: "가을 맑음 20℃",
    input: { tempC: 20, apparentTempC: 20, rainProbPct: 0, pm25: 12, windMs: 2, sunHours: 9, forestFireLevel: 1, emergencyRoomKm: 0 },
  },
  {
    name: "여름 폭염 34℃",
    input: { tempC: 34, apparentTempC: 36, rainProbPct: 10, pm25: 30, windMs: 2, sunHours: 9, forestFireLevel: 2, emergencyRoomKm: 0 },
  },
  {
    // 겨울은 체감온도(apparentTempC)가 없다 — 기상청 여름철 산식이라 kma.ts가 5~9월만 계산한다.
    // 최고 -2℃ / 최저 -11℃로 낮 쾌적(TCI)과 아침 한파(COLD)를 따로 태운다.
    name: "겨울 맑음 최고-2℃/최저-11℃",
    input: { tempC: -2, tminC: -11, rainProbPct: 0, pm25: 20, windMs: 3, sunHours: 8, forestFireLevel: 2, emergencyRoomKm: 0 },
  },
  {
    name: "봄 건조 산불3단계",
    input: { tempC: 18, apparentTempC: 18, rainProbPct: 0, pm25: 40, windMs: 6, sunHours: 9, forestFireLevel: 3, emergencyRoomKm: 0 },
  },
  {
    name: "장마 호우 70mm",
    input: { tempC: 25, apparentTempC: 28, rainProbPct: 90, rainMm: 70, pm25: 10, windMs: 5, sunHours: 1, forestFireLevel: 1, emergencyRoomKm: 0 },
  },
];

const places = applyEnvTypeOverrides(rawPlaces as unknown as Place[]);

/** 시나리오 기상 + 장소별 실계산 거리로 전 관광지 채점 */
function scoreAll(base: RiskInput) {
  return places.map((p) => {
    const input: RiskInput = {
      ...base,
      emergencyRoomKm: Math.round(nearestHospitalKm(p.lat, p.lng, p.contentId) * 10) / 10,
      shelterKm: Math.round(nearestShelterKm(p.lat, p.lng, p.contentId) * 10) / 10,
    };
    return { ...p, safety: computeSafetyScore(input, p, "default") };
  });
}

console.log(`대상 관광지 ${places.length}곳 · 시나리오 ${SCENARIOS.length}종\n`);

const uniformGrade: string[] = [];
const spreads: number[] = [];
/** 시나리오별 시군 순위(안전점수 높은 순) — 순위가 조건에 따라 바뀌는지 확인용 */
const orders: string[][] = [];

for (const { name, input } of SCENARIOS) {
  const regions = summarizeRegions(scoreAll(input));
  const scored = regions.filter((r) => r.medianScore !== null);
  const scores = scored.map((r) => r.medianScore as number);
  const spread = Math.max(...scores) - Math.min(...scores);
  spreads.push(spread);
  orders.push(scored.map((r) => r.name));

  const grades: Record<string, number> = {};
  for (const r of scored) grades[r.grade as string] = (grades[r.grade as string] ?? 0) + 1;
  const gradeKeys = Object.keys(grades);
  if (gradeKeys.length === 1) uniformGrade.push(name);

  console.log(`[${name}]`);
  console.log(`  점수 ${Math.min(...scores)}~${Math.max(...scores)} · 스프레드 ${spread}점 · 등급 ${JSON.stringify(grades)}`);
  console.log(`  최고 ${scored.slice(0, 3).map((r) => `${r.name} ${r.medianScore}`).join(" · ")}`);
  console.log(`  최저 ${scored.slice(-3).map((r) => `${r.name} ${r.medianScore}`).join(" · ")}\n`);
}

/** 두 순위 배열의 Spearman 상관 — 같은 시군 집합이라 순위차만으로 계산 */
function rankCorr(a: string[], b: string[]): number {
  const rb = new Map(b.map((name, i) => [name, i]));
  const n = a.length;
  let d2 = 0;
  a.forEach((name, i) => {
    const j = rb.get(name);
    if (j !== undefined) d2 += (i - j) ** 2;
  });
  return 1 - (6 * d2) / (n * (n * n - 1));
}

// ── 요약: 지도가 정보를 담고 있는가 ──
// 등급이 전부 같으면 라벨로는 시군을 구분할 수 없다. 스프레드가 등급컷 간격(30점)보다
// 작으면 어떤 날에도 등급이 갈리기 어렵다. 시나리오 간 순위상관이 1에 가까우면
// 날씨가 바뀌어도 순서가 그대로 — 지도가 지형·인프라 같은 고정 특성만 그리고 있다는 뜻.
const pairs: number[] = [];
for (let i = 0; i < orders.length; i++) {
  for (let j = i + 1; j < orders.length; j++) pairs.push(rankCorr(orders[i], orders[j]));
}
const meanCorr = pairs.reduce((a, b) => a + b, 0) / pairs.length;

console.log("── 요약 ──");
console.log(`전 시군 동일 등급 시나리오: ${uniformGrade.length}/${SCENARIOS.length}${uniformGrade.length ? ` (${uniformGrade.join(", ")})` : ""}`);
console.log(`시군 점수 스프레드: ${Math.min(...spreads)}~${Math.max(...spreads)}점 (등급컷 간격 30점)`);
console.log(
  `시나리오 간 순위상관: 평균 ${meanCorr.toFixed(3)} (최소 ${Math.min(...pairs).toFixed(3)}) — 1에 가까울수록 날씨가 순위를 못 바꿈`,
);
