import { RISK_LAYERS, type RiskFactor } from "@/lib/safety/types";
import { layerTotals } from "@/lib/safety/layers";

/**
 * 감점을 쾌적/안전 두 층으로 갈라 보여주는 한 줄 — 상세·숙박상세·리포트 공용.
 *
 * "왜 이 점수인가"의 첫 답이다. 요인 막대(RiskBreakdownBar)를 다 읽기 전에
 * "관광이 불편해서 깎였나, 위험해서 깎였나"를 먼저 보여준다 — 총점만으로는
 * 맑고 추운 날의 '주의 요인 높음'과 산불 3단계의 '주의 요인 높음'이 구분되지 않는다.
 */
export default function RiskLayerSummary({
  factors,
  note,
}: {
  factors: RiskFactor[];
  /** 뒤에 붙는 각주 (예: "궂은날 기준") */
  note?: string;
}) {
  const totals = layerTotals(factors);
  return (
    <p className="mt-2 text-sm font-semibold text-slate-600">
      {RISK_LAYERS.map((layer, i) => {
        const points = totals[layer.id];
        return (
          <span key={layer.id}>
            {i > 0 && <span className="text-slate-300"> · </span>}
            <span aria-hidden="true">{layer.icon}</span> {layer.label}{" "}
            <span
              className={`tabular-nums ${points > 0 ? "text-slate-800" : "text-slate-300"}`}
            >
              −{points}점
            </span>
          </span>
        );
      })}
      {note && <span className="ml-1.5 font-normal text-slate-400">{note}</span>}
    </p>
  );
}
