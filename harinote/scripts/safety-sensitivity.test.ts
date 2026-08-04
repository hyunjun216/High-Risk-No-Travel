/**
 * 민감도 하네스 가드 — 발표에서 인용하는 수치를 CI가 지킨다.
 *
 * 24_safety_sensitivity.md가 앓던 병(문서에만 숫자가 있고 재현 코드가 없음)이
 * 재발하지 않게 하는 장치다. 그리드를 말없이 바꾸거나 등급 안정성이 무너지면 여기서 걸린다.
 */
import { describe, expect, it } from "vitest";
import {
  GRID_SIZE,
  buildGrid,
  buildMissingFieldGrid,
  buildPerturbations,
  checkGaugeOverflow,
  computeBaseline,
  measure,
  measureEnvSpread,
} from "./safety-sensitivity";

const cells = buildGrid();
const baseline = computeBaseline(cells);
const perturbations = buildPerturbations();
const results = perturbations.map((p) => measure(cells, baseline, p));

describe("민감도 그리드", () => {
  it("선언한 크기와 실제 셀 수가 같다 — 그리드 변경은 의도적이어야 한다", () => {
    expect(cells.length).toBe(GRID_SIZE);
    expect(GRID_SIZE).toBe(2475);
  });

  it("기상적으로 모순인 조합(호우 + 산불 고단계)을 만들지 않는다", () => {
    // 산불은 건조, 산사태·호우는 강우에서 발생한다(weights.ts LANDSLIDE 주석).
    // 이 조합이 섞이면 감점이 100을 넘어 0점으로 포화하고 유지율이 부풀려진다.
    const contradictory = cells.filter(
      (c) => (c.input.rainMm ?? 0) >= 45 && c.input.forestFireLevel >= 3,
    );
    expect(contradictory).toHaveLength(0);
  });

  it("교란 세트가 세 계층을 모두 덮는다", () => {
    const tiers = new Set(perturbations.map((p) => p.tier));
    expect([...tiers].sort()).toEqual(["A", "B", "C"]);
  });
});

describe("등급 안정성", () => {
  it("Tier A(안전층 밴드 ±20%)에서 활성 셀 등급이 90% 이상 유지된다", () => {
    // 하한선 — 붕괴는 잡되 미세한 변동은 허용한다. 실측값은
    // analysis/24_safety_sensitivity_result.md 참조(pnpm check:sensitivity로 재생성).
    for (const r of results.filter((r) => r.tier === "A")) {
      expect(r.keepRateActive, `${r.name} 유지율`).toBeGreaterThanOrEqual(0.9);
    }
  });

  // Tier A(안전층 밴드)보다 하한이 낮은 이유: envType 배율은 감점의 크기가 아니라
  // 전 축의 스케일을 한꺼번에 흔들어 등급컷 근처 셀을 더 많이 옮긴다. 실측 최저는
  // '실내 할인 ×0.3 −20%' 87.9%(대피소 축 제거로 점수대가 올라가며 90.1%에서 내려옴).
  it("Tier B(envType 배율 ±20%)에서 활성 셀 등급이 85% 이상 유지된다", () => {
    for (const r of results.filter((r) => r.tier === "B")) {
      expect(r.keepRateActive, `${r.name} 유지율`).toBeGreaterThanOrEqual(0.85);
    }
  });

  it("모든 교란에 활성 셀이 존재한다 — 재지 않은 축을 안정적이라 부르지 않는다", () => {
    for (const r of results) {
      expect(r.activeCells, `${r.name} 활성 셀`).toBeGreaterThan(0);
    }
  });
});

describe("결정성", () => {
  it("두 번 측정해도 같은 결과가 나온다", () => {
    const again = perturbations.map((p) => measure(cells, baseline, p));
    expect(again).toEqual(results);
  });

  it("그리드가 재실행마다 동일하다", () => {
    expect(buildGrid()).toEqual(cells);
  });
});

describe("부가 측정", () => {
  it("envType 변별력을 측정한다 — 결과 해석은 리포트에서 한다", () => {
    const spread = measureEnvSpread(cells);
    expect(spread.meanDistinctScores).toBeGreaterThan(1);
    expect(spread.meanDistinctScores).toBeLessThanOrEqual(5);
    expect(spread.gradeSplitRate).toBeGreaterThanOrEqual(0);
  });

  it("게이지 초과 검사가 결측 필드 그리드까지 훑는다", () => {
    const g = checkGaugeOverflow([...cells, ...buildMissingFieldGrid()]);
    expect(g.cellsChecked).toBe(cells.length + buildMissingFieldGrid().length);
  });
});
