# -*- coding: utf-8 -*-
# 26_collect_weather_panel.py — 일별 패널용 기상 수집 (Open-Meteo ERA5 아카이브, 무료·키불필요)
#
# 왜 20번을 안 쓰나: 20번은 2022만 받고, 좌표를 15번이 만든 30년 캐시(data/climate_daily_raw)
#   에서 꺼낸다. 사고 원자료가 2021·2022 두 해라 두 해가 필요하고, 좌표는 시군청 소재지라
#   30년치를 다시 받을 이유가 없다 (regions.ts SIGUNGU_SEATS와 동일 값을 여기 박아 둔다).
#
# 산출: data/climate_panel_raw/{시군}.json — 2021-01-01 ~ 2022-12-31 일별
#   temperature_2m_max/min, apparent_temperature_max/min, precipitation_sum, windspeed_10m_max
#   (체감온도는 ERA5 산식 — 기상청 여름철 산식과 다르므로 참고 축으로만 쓴다)
import json, os, time, urllib.parse, urllib.request

OUT = "data/climate_panel_raw"
os.makedirs(OUT, exist_ok=True)

# harinote/src/lib/risk/regions.ts SIGUNGU_SEATS — 값이 갈리면 그쪽이 기준
SEATS = {
    "강릉시": (37.7519, 128.8761), "고성군": (38.3806, 128.4678),
    "동해시": (37.5247, 129.1143), "삼척시": (37.4499, 129.1651),
    "속초시": (38.2070, 128.5918), "양구군": (38.1057, 127.9899),
    "양양군": (38.0752, 128.6190), "영월군": (37.1837, 128.4614),
    "원주시": (37.3387, 127.9201), "인제군": (38.0697, 128.1707),
    "정선군": (37.3806, 128.6608), "철원군": (38.1466, 127.3132),
    "춘천시": (37.8813, 127.7298), "태백시": (37.1641, 128.9856),
    "평창군": (37.3708, 128.3901), "홍천군": (37.6969, 127.8887),
    "화천군": (38.1062, 127.7082), "횡성군": (37.4917, 127.9850),
}

DAILY = ",".join([
    "temperature_2m_max", "temperature_2m_min",
    "apparent_temperature_max", "apparent_temperature_min",
    "precipitation_sum", "windspeed_10m_max",
])
START, END = "2021-01-01", "2022-12-31"

print(f"대상 {len(SEATS)}개 시군 · {START}~{END}")
for name, (lat, lng) in SEATS.items():
    out = f"{OUT}/{name}.json"
    if os.path.exists(out):
        print(f"  [skip] {name}")
        continue
    q = urllib.parse.urlencode({
        "latitude": lat, "longitude": lng,
        "start_date": START, "end_date": END,
        "daily": DAILY, "timezone": "Asia/Seoul",
    })
    with urllib.request.urlopen(
        f"https://archive-api.open-meteo.com/v1/archive?{q}", timeout=60
    ) as r:
        d = json.load(r)
    json.dump(d, open(out, "w", encoding="utf-8"), ensure_ascii=False)
    t = d["daily"]["time"]
    print(f"  [ok] {name}: {len(t)}일 ({t[0]}~{t[-1]})")
    time.sleep(0.5)  # 예의상 간격
print("완료")
