/**
 * 민감도 분석 실행 + 산출물 기록 — 실행: pnpm check:sensitivity
 *
 * 산출물 (둘 다 git 추적):
 *   analysis/data/safety_sensitivity_summary.csv   교란별 1행
 *   analysis/24_safety_sensitivity_result.md       발표·문서 인용용 요약
 *
 * 결정적이다 — 같은 코드에서 두 번 돌리면 바이트 단위로 같은 파일이 나온다
 * (생성 시각을 쓰지 않는 이유). 이게 "문서에만 있는 숫자"를 막는 장치다.
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  GRID_SIZE,
  buildGrid,
  buildMissingFieldGrid,
  buildPerturbations,
  checkGaugeOverflow,
  computeBaseline,
  measure,
  measureEnvSpread,
  type Result,
} from "./safety-sensitivity";

const ROOT = path.resolve(import.meta.dirname, "../..");
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const num = (v: number) => v.toFixed(2);

function engineRef(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim();
    const dirty = execSync("git status --porcelain -- harinote/src/lib/safety", {
      cwd: ROOT,
    })
      .toString()
      .trim();
    return dirty ? `${sha} (+ 미커밋 변경)` : sha;
  } catch {
    return "unknown";
  }
}

const cells = buildGrid();
const baseline = computeBaseline(cells);
const results = buildPerturbations().map((p) => measure(cells, baseline, p));

const saturatedBase =
  baseline.filter((b) => b.score === 0 || b.score === 100).length / baseline.length;
const gradeDist = baseline.reduce<Record<string, number>>((acc, b) => {
  acc[b.grade] = (acc[b.grade] ?? 0) + 1;
  return acc;
}, {});

const gauge = checkGaugeOverflow([...cells, ...buildMissingFieldGrid()]);
const spread = measureEnvSpread(cells);

// ── 콘솔 요약 ──
console.log(`그리드 ${GRID_SIZE}셀 × 교란 ${results.length}종 = ${GRID_SIZE * results.length}건`);
console.log(`기준선 등급 분포 ${JSON.stringify(gradeDist)} · 포화(0/100점) ${pct(saturatedBase)}\n`);

for (const tier of ["A", "B", "C"] as const) {
  const rows = results.filter((r) => r.tier === tier);
  if (!rows.length) continue;
  console.log(`── Tier ${tier} ──`);
  for (const r of rows) {
    const note = r.zeroEffectReason ? `  ⚠ ${r.zeroEffectReason}` : "";
    console.log(
      `  ${r.name.padEnd(28)} 활성 ${String(r.activeCells).padStart(6)}` +
        `  유지 ${pct(r.keepRateActive).padStart(7)}` +
        `  |Δ| 평균 ${num(r.meanAbsDelta).padStart(5)} 최대 ${String(r.maxAbsDelta).padStart(3)}${note}`,
    );
  }
  console.log();
}

console.log("── 요인 게이지 상한 초과 (E4) ──");
console.log(
  `  ${gauge.overflowCells}/${gauge.cellsChecked}셀` +
    (gauge.worst
      ? ` · 최악 ${gauge.worst.key} ${gauge.worst.points}/${gauge.worst.maxPoints}`
      : " · 초과 없음"),
);
console.log("\n── envType이 만드는 변별력 (E1) ──");
console.log(
  `  날씨 조합당 서로 다른 점수 ${num(spread.meanDistinctScores)}개(최대 5)` +
    ` · 점수 폭 ${num(spread.meanSpread)}점 · 등급이 갈리는 조합 ${pct(spread.gradeSplitRate)}`,
);

// ── CSV ──
const csvHeader =
  "tier,name,active_cells,keep_rate_active,keep_rate_all,saturated_rate," +
  "mean_abs_delta,max_abs_delta,mean_cut_distance_of_flips,flips_near_cut_rate,zero_effect_reason";
const csvRow = (r: Result) =>
  [
    r.tier,
    `"${r.name}"`,
    r.activeCells,
    r.keepRateActive.toFixed(4),
    r.keepRateAll.toFixed(4),
    r.saturatedRate.toFixed(4),
    r.meanAbsDelta.toFixed(3),
    r.maxAbsDelta,
    r.meanCutDistanceOfFlips.toFixed(2),
    r.flipsNearCutRate.toFixed(4),
    r.zeroEffectReason ?? "",
  ].join(",");
const csvPath = path.join(ROOT, "analysis/data/safety_sensitivity_summary.csv");
writeFileSync(csvPath, [csvHeader, ...results.map(csvRow)].join("\n") + "\n");

// ── MD ──
const mdTable = (tier: "A" | "B" | "C") =>
  results
    .filter((r) => r.tier === tier)
    .map(
      (r) =>
        `| ${r.name} | ${r.activeCells.toLocaleString()} | **${pct(r.keepRateActive)}** | ` +
        `${pct(r.keepRateAll)} | ${num(r.meanAbsDelta)} | ${r.maxAbsDelta} | ` +
        `${r.zeroEffectReason ?? (r.flipsNearCutRate > 0 ? `등급컷 ±5점 이내 ${pct(r.flipsNearCutRate)}` : "—")} |`,
    )
    .join("\n");

const tierAWorst = Math.min(
  ...results.filter((r) => r.tier === "A").map((r) => r.keepRateActive),
);
const tierBWorst = Math.min(
  ...results.filter((r) => r.tier === "B").map((r) => r.keepRateActive),
);

const md = `# 24-결과. 안전점수 민감도 분석 실측

> **이 파일은 산출물이다 — 직접 수정하지 말 것.**
> 재현: \`cd harinote && pnpm check:sensitivity\`
> 엔진: \`harinote/src/lib/safety/\` @ ${engineRef()}
> 방법·설계 근거는 [24_safety_sensitivity.md](24_safety_sensitivity.md) 참조.

## 왜 재는가

축의 존재와 임계점(산불 4단계·호우 특보·골든타임)은 정부 공인 기준에 앵커돼 있다.
그러나 **감점 밴드의 절대값**(산불 15/45/80 등)과 **환경유형 배율**(계곡 강수 ×1.5 등)은
설계값이고, 사고 데이터에 좌표가 없어 실증 보정이 원천적으로 불가능하다
([25_safety_evidence_map.md](25_safety_evidence_map.md) 참조).

따라서 방어는 "이 값이 맞다"가 아니라 **"이 값이 틀려도 결정이 바뀌지 않는다"**여야 한다.

## 측정 설계

- 그리드 **${GRID_SIZE.toLocaleString()}셀** = 체감온도 5 × 강수 4 × 미세먼지 3 × 산불 4단계 ×
  산사태 3 × 응급의료·대피소 3 × 환경유형 **5(전체)**
- 교란 **${results.length}종** × 그리드 = **${(GRID_SIZE * results.length).toLocaleString()}건**
- 서비스가 실제로 쓰는 \`computeSafetyScore\`를 그대로 호출한다 (별도 포팅 없음)

**유지율은 '활성 셀' 기준이 헤드라인이다.** 산불 밴드 교란은 산불 2단계 이상 셀에서만
의미가 있는데, 1단계 셀(감점 0)을 분모에 넣으면 유지율이 인위적으로 올라간다.
전체 기준 수치도 함께 싣되 참고용으로 둔다.

기준선 등급 분포: ${Object.entries(gradeDist)
  .map(([g, n]) => `${g} ${n.toLocaleString()}`)
  .join(" · ")} · 바닥/천장 포화(0점 또는 100점) **${pct(saturatedBase)}**
(포화 셀은 어떤 교란에도 등급이 움직이지 않아 유지율을 끌어올린다 — 해석 시 감안할 것)

## Tier A — 안전층 밴드 ±20% (근거: 등급컷 앵커 설계값)

| 교란 | 활성 셀 | 유지율(활성) | 유지율(전체) | \\|Δ\\| 평균 | \\|Δ\\| 최대 | 비고 |
|---|---:|---:|---:|---:|---:|---|
${mdTable("A")}

## Tier B — 환경유형 배율 ±20% (근거: 방향만 탐색적, 크기는 설계값)

| 교란 | 활성 셀 | 유지율(활성) | 유지율(전체) | \\|Δ\\| 평균 | \\|Δ\\| 최대 | 비고 |
|---|---:|---:|---:|---:|---:|---|
${mdTable("B")}

## Tier C — 환경유형 절제 (근거 없는 층이 결정에 얼마나 관여하는가)

±20%가 맞느냐를 묻는 대신, **그 층을 통째로 없애면 등급이 얼마나 달라지는가**를 잰다.
근거가 설계값인 층에 대해서는 이쪽이 정직한 질문이다.

| 교란 | 활성 셀 | 유지율(활성) | 유지율(전체) | \\|Δ\\| 평균 | \\|Δ\\| 최대 | 비고 |
|---|---:|---:|---:|---:|---:|---|
${mdTable("C")}

## 부가 측정

**요인 게이지 상한 초과**: ${gauge.overflowCells}/${gauge.cellsChecked}셀${
  gauge.worst
    ? ` · 최악 \`${gauge.worst.key}\` ${gauge.worst.points}/${gauge.worst.maxPoints}`
    : " — 초과 없음"
}
(중기예보처럼 풍속·일조가 결측이면 TCI가 축을 빼고 재정규화하는데, 표시 상한이 5축 기준
정적값이면 게이지가 100%를 넘는다.)

**환경유형이 만드는 변별력**: 같은 날씨 조합에서 envType만 달라질 때
서로 다른 점수 **${num(spread.meanDistinctScores)}개**(최대 5) · 점수 폭 **${num(spread.meanSpread)}점** ·
envType만으로 등급이 갈리는 조합 **${pct(spread.gradeSplitRate)}**
(발표자료 부록 "기상은 시군 단위인데 관광지 위험을 설명 가능한가 → 환경유형 가중으로
보정한다"는 답이 실제로 참인지에 대한 수치.)

## 요약

- Tier A 최저 유지율 **${pct(tierAWorst)}** — 안전층 밴드 절대값을 ±20% 흔들어도 등급은 이만큼 유지된다
- Tier B 최저 유지율 **${pct(tierBWorst)}** — 환경유형 배율도 같은 폭에서 이만큼 유지된다
`;

writeFileSync(path.join(ROOT, "analysis/24_safety_sensitivity_result.md"), md);
console.log(`\n기록: analysis/data/safety_sensitivity_summary.csv · analysis/24_safety_sensitivity_result.md`);
