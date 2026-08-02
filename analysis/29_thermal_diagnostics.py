# -*- coding: utf-8 -*-
# 29_thermal_diagnostics.py — 28번의 귀무 결과가 설계 탓인지 데이터 탓인지 가른다
#
# 28번은 기온 스플라인이 유의하지 않다고 보고했다(p=0.13~0.38). 두 해석이 가능하다:
#   (A) 기온이 정말 사고를 안 늘린다
#   (B) 연-월 고정효과가 기온 신호를 먹었다 — 월 FE는 "그 달의 관광객 수"와
#       "그 달의 평균 기온"을 동시에 흡수하므로, 계절 규모의 기온 효과가 통째로 빠진다
# 둘을 가르려면 통제를 단계적으로 벗기며 계수가 살아나는지 본다.
#
# 결론이 (B)라면: 계절 기온 효과를 보려면 월 FE를 빼야 하고, 그러면 노출 편향을
#   막을 다른 장치(방문자수 offset)가 필요하다 → data.go.kr 15101972가 그 열쇠다.
import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf

df = pd.read_csv("data/daily_panel.csv", encoding="utf-8-sig")
df["ym"] = df["ym"].astype(str)

SPECS = [
    ("① 시군FE + 연월FE (28번 본 모델)", "C(sigungu) + C(ym)"),
    ("② 시군FE + 연FE (월 통제 제거)", "C(sigungu) + C(year)"),
    ("③ 시군FE만 (계절 통제 없음)", "C(sigungu)"),
]

print("아웃컴: acc_outdoor (야외 사고 1,721건) · 기온: tmax 스플라인 df=5")
print("=" * 74)
for label, controls in SPECS:
    f = f"acc_outdoor ~ bs(tmax, df=5) + precip + wind_ms + is_weekend + {controls}"
    m = smf.glm(f, data=df, family=sm.families.Poisson()).fit(
        cov_type="cluster", cov_kwds={"groups": df["sigungu"]}
    )
    terms = [n for n in m.params.index if n.startswith("bs(tmax")]
    idx = [m.params.index.get_loc(t) for t in terms]
    w = m.wald_test(np.eye(len(m.params))[idx], scalar=True)
    print(f"{label:<34} 스플라인 p = {w.pvalue:.4g}")

# ── ④ 노출 분모가 들어오면 켜지는 스펙 ──
# 월 FE는 계절 노출과 계절 기온을 함께 흡수한다(위 ①②). 방문자수를 offset으로 넣으면
# 노출만 통제하고 계절 기온 변동은 남길 수 있다 — 이게 30번이 지목한 유일한 해법이다.
if "visitors" in df.columns and df["visitors"].notna().any():
    sub = df[df["visitors"].notna() & (df["visitors"] > 0)].copy()
    sub["log_exposure"] = np.log(sub["visitors"])
    f4 = ("acc_outdoor ~ bs(tmax, df=5) + precip + wind_ms + is_weekend "
          "+ C(sigungu) + C(year)")
    m4 = smf.glm(f4, data=sub, family=sm.families.Poisson(),
                 offset=sub["log_exposure"]).fit(
        cov_type="cluster", cov_kwds={"groups": sub["sigungu"]}
    )
    terms = [n for n in m4.params.index if n.startswith("bs(tmax")]
    idx = [m4.params.index.get_loc(t) for t in terms]
    w4 = m4.wald_test(np.eye(len(m4.params))[idx], scalar=True)
    print(f"{'④ 시군FE + 연FE + offset(log 방문자수)':<34} 스플라인 p = {w4.pvalue:.4g}")
    print("   → 월 FE 없이 노출만 통제. 여기서 유의하면 기온 배점을 실증 보정할 수 있다")
else:
    print(f"{'④ offset(log 방문자수)':<34} 건너뜀 — data/visitors_monthly.csv 없음")
    print("   → 이 스펙이 켜져야 기온 배점 보정이 가능하다 (docs/API키_발급_가이드.md §3.6)")

# ── 과대산포 대응: 음이항 ──
print("\n[과대산포 대응] 음이항(NB2) — 포아송 대비 표준오차가 커진다")
f = "acc_outdoor ~ bs(tmax, df=5) + precip + wind_ms + is_weekend + C(sigungu) + C(ym)"
nb = smf.glm(f, data=df, family=sm.families.NegativeBinomial(alpha=1.0)).fit(
    cov_type="cluster", cov_kwds={"groups": df["sigungu"]}
)
terms = [n for n in nb.params.index if n.startswith("bs(tmax")]
idx = [nb.params.index.get_loc(t) for t in terms]
w = nb.wald_test(np.eye(len(nb.params))[idx], scalar=True)
print(f"  음이항 스플라인 p = {w.pvalue:.4g}")

# ── 검정력 진단: 이 표본으로 잡을 수 있는 효과 크기 ──
print("\n[검정력] 이 표본이 얼마나 큰 효과까지 잡을 수 있나")
print(f"  셀 {len(df)} · 야외사고 {df['acc_outdoor'].sum()}건 · 셀당 평균 {df['acc_outdoor'].mean():.3f}")
print(f"  0-사고 셀 {(df['acc_outdoor'] == 0).mean():.1%}")
# 강수는 같은 설계에서 유의한가 — 설계 자체가 죽었는지 확인하는 양성 대조군
f2 = "acc_outdoor ~ precip + bs(tmax, df=5) + wind_ms + is_weekend + C(sigungu) + C(ym)"
m2 = smf.glm(f2, data=df, family=sm.families.Poisson()).fit(
    cov_type="cluster", cov_kwds={"groups": df["sigungu"]}
)
print(f"\n[양성 대조군] 같은 설계에서 강수(precip) 계수")
print(f"  계수 {m2.params['precip']:+.5f} · p = {m2.pvalues['precip']:.4g}")
print(f"  주말(is_weekend) 계수 {m2.params['is_weekend']:+.4f} · p = {m2.pvalues['is_weekend']:.4g}")
print("  → 주말·강수가 유의하면 설계는 살아 있고, 기온만 신호가 없다는 뜻")
