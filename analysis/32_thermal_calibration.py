# -*- coding: utf-8 -*-
# 32_thermal_calibration.py — 노출 분모를 넣은 기온–사고 반응 곡선
#
# 29번 스펙 ④가 p=0.061(경계)로 나왔다. p값 하나로 결론 내리지 않기 위해
#   (a) 사전에 정한 변형을 **전부** 돌려 보고(체리피킹 방지),
#   (b) 유의성과 별개로 **효과의 크기와 모양**을 현행 곡선과 대조한다.
#
# 변형(2×2×2): 아웃컴(야외/전체) × 기온(tmax/tmin) × 분포(포아송/음이항)
#   — 어느 하나를 고르지 않고 8개를 모두 표로 낸다.
#
# 식별: offset(log 외지인 방문자수)로 노출을 통제하고 월 FE는 뺀다.
#   월 FE를 두면 계절 노출과 함께 계절 기온까지 흡수된다(30번 참조).
import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf

df = pd.read_csv("data/daily_panel.csv", encoding="utf-8-sig")
df = df[df["visitors"].notna() & (df["visitors"] > 0)].copy()
df["log_exposure"] = np.log(df["visitors"])
print(f"패널 {len(df)}행 (노출 결측 제외) · 외지인 방문자 중앙값 {df['visitors'].median():,.0f}\n")

CONTROLS = "precip + wind_ms + is_weekend + C(sigungu) + C(year)"
FAMILIES = {
    "포아송": sm.families.Poisson(),
    "음이항": sm.families.NegativeBinomial(alpha=1.0),
}

rows = []
curves = []
for outcome in ["acc_outdoor", "acc_all"]:
    for temp in ["tmax", "tmin"]:
        for fam_name, fam in FAMILIES.items():
            f = f"{outcome} ~ bs({temp}, df=5) + {CONTROLS}"
            m = smf.glm(f, data=df, family=fam, offset=df["log_exposure"]).fit(
                cov_type="cluster", cov_kwds={"groups": df["sigungu"]}
            )
            terms = [n for n in m.params.index if n.startswith(f"bs({temp}")]
            idx = [m.params.index.get_loc(t) for t in terms]
            p = float(m.wald_test(np.eye(len(m.params))[idx], scalar=True).pvalue)

            # 반응 곡선 — 다른 축은 중앙값 고정, 기온만 격자로 움직인다
            lo, hi = df[temp].quantile([0.01, 0.99])
            grid = np.linspace(lo, hi, 40)
            base = df.iloc[[0]].copy()
            X = pd.concat([base.assign(**{temp: t}) for t in grid], ignore_index=True)
            X["precip"] = df["precip"].median()
            X["wind_ms"] = df["wind_ms"].median()
            X["is_weekend"] = 0
            pred = m.predict(X, offset=np.zeros(len(X)))
            rr = (pred / pred.min()).values
            mmt = grid[int(np.argmin(rr))]
            rows.append({
                "아웃컴": outcome, "기온": temp, "분포": fam_name,
                "p": p, "MMT": round(float(mmt), 1),
                "RR최대": round(float(rr.max()), 2),
                "한랭단RR": round(float(rr[:4].mean()), 2),
                "고온단RR": round(float(rr[-4:].mean()), 2),
            })
            if outcome == "acc_outdoor" and fam_name == "포아송":
                curves.append(pd.DataFrame({"temp": grid, "rr": rr, "temp_var": temp}))

res = pd.DataFrame(rows)
print(res.to_string(index=False))
sig = (res["p"] < 0.05).sum()
print(f"\n8개 변형 중 p<0.05: {sig}개")

pd.concat(curves, ignore_index=True).to_csv(
    "data/thermal_curve_offset.csv", index=False, encoding="utf-8-sig"
)

# ── 현행 엔진 곡선과 대조 ──
# tci.ts thermalScore의 감점 비율(1 − 정규화점수)을 같은 격자에서 계산한다.
LADDER = [(37, -3), (35, -1), (33, 1), (31, 2), (28, 3), (25, 4), (18, 5),
          (15, 4), (10, 3), (5, 2), (0, 1), (-5, -1)]


def thermal_score(t: float) -> float:
    for thr, s in LADDER:
        if t >= thr:
            return s
    return -3


def engine_deduction_ratio(t: float) -> float:
    """감점/배점 — 0(무감점)~1(배점 전부)"""
    return 1 - max(0.0, min(1.0, (thermal_score(t) + 3) / 8))


c = curves[0]  # acc_outdoor × tmax × 포아송
print("\n현행 엔진 열쾌적 감점 vs 데이터 상대위험도 (tmax)")
print("기온   엔진 감점비율   데이터 RR")
for t in [-10, -5, 0, 5, 10, 15, 20, 25, 30, 33]:
    near = c.iloc[(c["temp"] - t).abs().argsort().iloc[0]]
    print(f"{t:4d}℃      {engine_deduction_ratio(t):.2f}         {near['rr']:.2f}")
print("\n저장: data/thermal_curve_offset.csv")
