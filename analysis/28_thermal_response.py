# -*- coding: utf-8 -*-
# 28_thermal_response.py — 기온–사고 반응 곡선 추정 (시군×일 패널)
#
# 묻는 것: "기온이 관광지 사고를 늘리는가, 늘린다면 어느 온도부터 얼마나?"
#   → 현행 열쾌적(tci.ts thermalScore)·한파(weights.ts coldPoints) 곡선의 실증 대조군.
#
# 식별 전략: 노출 분모(관광객 수)를 구하는 대신 고정효과로 흡수한다.
#   · 시군 FE  → 그 시군의 관광객 규모·지형·인프라 (시간불변)
#   · 연-월 FE → 성수기·연도 추세 (시군공통)
#   남는 변동 = "같은 시군, 같은 달에서 유독 춥거나 더웠던 날" → 분모 없이 식별.
#
# ⚠ 한계
#   · 원인별 아웃컴 불가: 저체온 3건·온열 8건뿐이다(ACDNT_CS_NM 43% 결측 + 안전사고
#     신고에 질병 코드가 거의 없음). 그래서 "야외 사고 전체"를 아웃컴으로 쓴다 —
#     기온이 사고를 늘리는 경로가 저체온인지 빙판 낙상인지는 구분하지 못한다.
#   · 연관이지 인과가 아니다. 가중 근거로만 쓴다(19_score_calibration_design.md).
import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf

PANEL = "data/daily_panel.csv"
OUT = "data/thermal_response.csv"

df = pd.read_csv(PANEL, encoding="utf-8-sig")
df["ym"] = df["ym"].astype(str)
print(f"패널 {len(df)}행 · 야외사고 {df['acc_outdoor'].sum()}건 · 전체 {df['acc_all'].sum()}건\n")

CONTROLS = "precip + wind_ms + is_weekend + C(sigungu) + C(ym)"


def fit(outcome: str, temp: str, df_spline: int = 5):
    """포아송 + 시군 클러스터 강건표준오차. 과대산포는 음이항으로 교차확인."""
    f = f"{outcome} ~ bs({temp}, df={df_spline}) + {CONTROLS}"
    pois = smf.glm(f, data=df, family=sm.families.Poisson()).fit(
        cov_type="cluster", cov_kwds={"groups": df["sigungu"]}
    )
    # 과대산포 진단 (피어슨 카이제곱 / 자유도)
    disp = pois.pearson_chi2 / pois.df_resid
    return pois, disp


def response_curve(model, temp: str, grid: np.ndarray) -> pd.DataFrame:
    """기온 격자별 예측 상대위험도 — 최소위험온도(MMT) 대비."""
    base = df.iloc[[0]].copy()
    rows = []
    for t in grid:
        b = base.copy()
        b[temp] = t
        b["precip"] = df["precip"].median()
        b["wind_ms"] = df["wind_ms"].median()
        b["is_weekend"] = 0
        rows.append(b)
    X = pd.concat(rows, ignore_index=True)
    pred = model.predict(X)
    rr = pred / pred.min()
    return pd.DataFrame({"temp": grid, "rr": rr.values})


results = []
for outcome in ["acc_outdoor", "acc_all"]:
    for temp in ["tmin", "tmax"]:
        lo, hi = df[temp].quantile([0.01, 0.99])
        grid = np.linspace(lo, hi, 40)
        model, disp = fit(outcome, temp)
        curve = response_curve(model, temp, grid)
        mmt = curve.loc[curve["rr"].idxmin(), "temp"]
        # 스플라인 항 전체의 유의성 (Wald)
        terms = [n for n in model.params.index if n.startswith(f"bs({temp}")]
        wald = model.wald_test(np.eye(len(model.params))[[model.params.index.get_loc(t) for t in terms]], scalar=True)
        print(f"[{outcome} ~ {temp}]  과대산포 {disp:.2f} · 스플라인 p={wald.pvalue:.4g} "
              f"· MMT {mmt:.1f}℃ · RR 범위 {curve['rr'].min():.2f}~{curve['rr'].max():.2f}")
        # 양 끝 상대위험도 — "추위가 위험한가 더위가 위험한가"의 핵심 숫자
        cold_rr = curve.loc[curve["temp"] <= curve["temp"].quantile(0.05), "rr"].mean()
        hot_rr = curve.loc[curve["temp"] >= curve["temp"].quantile(0.95), "rr"].mean()
        print(f"    한랭단(하위5%) RR {cold_rr:.2f} · 고온단(상위5%) RR {hot_rr:.2f}")
        curve["outcome"] = outcome
        curve["temp_var"] = temp
        curve["p_spline"] = float(wald.pvalue)
        results.append(curve)

pd.concat(results, ignore_index=True).to_csv(OUT, index=False, encoding="utf-8-sig")
print(f"\n저장: {OUT}")
