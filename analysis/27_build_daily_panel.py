# -*- coding: utf-8 -*-
# 27_build_daily_panel.py — 시군×일 패널 빌드 (2021~2022)
#
# 왜 일 단위인가: 21번의 시군×월 216셀은 노출 분모(관광객 수)가 없어 멈춰 있었다
#   (19_score_calibration_design.md "유일한 갭"). 일 단위로 내려가면 **시군 고정효과**가
#   그 시군의 관광객 규모를, **연-월 고정효과**가 성수기를 흡수한다. 남는 변동은
#   "같은 시군 같은 달에서 날씨가 나빴던 날"이라 분모 없이 식별된다
#   (환경역학의 time-stratified 설계).
#
# 입력: data/accidents/*(119 원자료 2021·2022) + data/climate_panel_raw/*(26번 산출)
# 출력: data/daily_panel.csv — 시군 18 × 일 730 = 13,140행
import csv, glob, io, json, os, re
from collections import defaultdict
from datetime import date

import pandas as pd

ACC_FILES = [
    "data/accidents/안전사고_0000_관광지/안전사고_0000_관광지.csv",
    "data/accidents/안전사고_0000/안전사고_0000.csv",
]
WX_DIR = "data/climate_panel_raw"
OUT = "data/daily_panel.csv"

SG18 = [os.path.splitext(os.path.basename(f))[0] for f in sorted(glob.glob(f"{WX_DIR}/*.json"))]
assert len(SG18) == 18, f"시군 기상 파일이 18개가 아님: {len(SG18)}"

# ── 원인 분류 (22_outcome_filter_check.py 규칙 계승 + 열 관련 세분) ──
# ⚠ ACDNT_CS_NM 결측이 43%다. 원인별 아웃컴은 그만큼 과소집계되므로 "탐색적"으로만 쓴다.
CAUSE = {
    "cold_injury": re.compile(r"저체온|동상|한랭"),
    "heat_injury": re.compile(r"온열|열사|일사|탈진"),
    "fall": re.compile(r"낙상|추락|미끄|실족"),
    "water": re.compile(r"익수|수난|물놀이"),
}
# 야외 장소 — 기상 노출이 있는 곳만 (실내·주거는 날씨와 무관)
OUTDOOR_PLC = re.compile(r"바다|강|산|논밭|운동|오락|문화|도로외")
INDOOR_PLC = re.compile(r"^도로$|^집$|집단거주|상업시설|학교|교육")


def load_accidents() -> pd.DataFrame:
    rows = []
    for path in ACC_FILES:
        with io.open(path, encoding="utf-8-sig", newline="") as f:
            rows.extend(csv.DictReader(f))
    df = pd.DataFrame(rows)
    df = df[df["GRNDS_SGG_NM"].isin(SG18)].copy()
    df["d"] = pd.to_datetime(
        df["DCLR_YR"] + "-" + df["DCLR_MM"].str.zfill(2) + "-" + df["DCLR_DAY"].str.zfill(2),
        errors="coerce",
    )
    df = df.dropna(subset=["d"])
    cs = df["ACDNT_CS_NM"].fillna("")
    plc = df["ACDNT_OCRN_PLC_NM"].fillna("")
    df["outdoor"] = plc.str.contains(OUTDOOR_PLC) & ~plc.str.contains(INDOOR_PLC)
    for name, rx in CAUSE.items():
        df[name] = cs.str.contains(rx)
    return df


def load_weather() -> pd.DataFrame:
    rows = []
    for sg in SG18:
        d = json.load(open(f"{WX_DIR}/{sg}.json", encoding="utf-8"))["daily"]
        for i, t in enumerate(d["time"]):
            rows.append({
                "sigungu": sg,
                "d": t,
                "tmax": d["temperature_2m_max"][i],
                "tmin": d["temperature_2m_min"][i],
                "app_tmax": d["apparent_temperature_max"][i],
                "app_tmin": d["apparent_temperature_min"][i],
                "precip": d["precipitation_sum"][i],
                "wind_ms": (d["windspeed_10m_max"][i] or 0) / 3.6,  # km/h → m/s
            })
    wx = pd.DataFrame(rows)
    wx["d"] = pd.to_datetime(wx["d"])
    return wx


acc = load_accidents()
wx = load_weather()

# ── 사고를 시군×일로 집계 ──
g = acc.groupby(["GRNDS_SGG_NM", "d"])
agg = g.size().rename("acc_all").to_frame()
agg["acc_outdoor"] = g["outdoor"].sum().astype(int)
for name in CAUSE:
    agg[name] = g[name].sum().astype(int)
agg = agg.reset_index().rename(columns={"GRNDS_SGG_NM": "sigungu"})

panel = wx.merge(agg, on=["sigungu", "d"], how="left")
count_cols = ["acc_all", "acc_outdoor", *CAUSE]
panel[count_cols] = panel[count_cols].fillna(0).astype(int)

# ── 통제 변수 ──
panel["year"] = panel["d"].dt.year
panel["month"] = panel["d"].dt.month
panel["ym"] = panel["d"].dt.strftime("%Y-%m")
panel["dow"] = panel["d"].dt.dayofweek          # 0=월
panel["is_weekend"] = (panel["dow"] >= 5).astype(int)
panel = panel.sort_values(["sigungu", "d"]).reset_index(drop=True)
panel.to_csv(OUT, index=False, encoding="utf-8-sig")

# ── 요약 ──
n_days = panel["d"].nunique()
print(f"패널: {panel.shape[0]}행 (시군 {panel['sigungu'].nunique()} × 일 {n_days})")
print(f"사고 총계: all={panel['acc_all'].sum()} · 야외={panel['acc_outdoor'].sum()}")
print("원인별(ACDNT_CS_NM 결측 43% — 과소집계):")
for name in CAUSE:
    print(f"  {name:<12} {panel[name].sum():5d}건 · 발생일 {int((panel[name] > 0).sum()):4d}셀")
zero = (panel["acc_all"] == 0).mean()
print(f"0-사고 셀: {zero:.1%} → 영과잉(ZINB) 검토 필요")
print(f"일평균 사고: {panel['acc_all'].mean():.2f} · 최대 {panel['acc_all'].max()}")
print(f"\n기온 범위: tmin {panel['tmin'].min():.1f} ~ tmax {panel['tmax'].max():.1f}℃")
print(f"저장: {OUT}")
