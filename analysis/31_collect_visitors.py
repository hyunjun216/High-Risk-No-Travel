# -*- coding: utf-8 -*-
# 31_collect_visitors.py — 강원 시군별 **일별 외지인 방문자수** 수집 (노출 분모)
#
# 왜 필요한가: 30번이 보인 대로, 이 분모 없이는 기온 효과를 노출과 분리할 수 없다.
#   날씨가 관광객 수에도 영향을 주고 사고에도 영향을 주기 때문에, 월 고정효과로
#   계절을 통제하면 기온 신호까지 함께 죽는다. offset(log 방문자수)이 유일한 해법이다.
#
# 원본: 한국관광공사_빅데이터_지역별 방문자수_GW (data.go.kr 15101972)
#   - 엔드포인트: apis.data.go.kr/B551011/DataLabService/locgoRegnVisitrDDList
#   - TOUR_API_KEY 재사용 (계정 단위 키 — 해당 API 활용신청은 별도로 필요)
#   - touDivCd: 1 현지인 / 2 **외지인** / 3 외국인 → 관광객 대리지표는 2
#   - areaCd 파라미터는 값을 주면 빈 응답이 온다(실측) → 전국을 받아 signguCode로 거른다
#
# 산출: data/visitors_daily.csv  (sigungu, d, visitors)
import csv, io, json, os, sys, time, urllib.parse, urllib.request
from datetime import date, timedelta

OUT = "data/visitors_daily.csv"
BASE = "https://apis.data.go.kr/B551011/DataLabService/locgoRegnVisitrDDList"
START, END = date(2021, 1, 1), date(2022, 12, 31)
CHUNK_DAYS = 7          # 실측: 7일 = 5,481행 (numOfRows 여유 있게)
GANGWON_PREFIX = "51"   # 강원특별자치도 시군구 코드 접두

# 사고·기상 패널과 이름이 맞아야 병합된다 (regions.ts SIGUNGU_SEATS)
EXPECTED = {
    "강릉시", "고성군", "동해시", "삼척시", "속초시", "양구군", "양양군", "영월군",
    "원주시", "인제군", "정선군", "철원군", "춘천시", "태백시", "평창군", "홍천군",
    "화천군", "횡성군",
}


def load_key() -> str:
    """harinote/.env.local에서 TOUR_API_KEY를 읽는다 (키는 절대 출력하지 않는다)."""
    for path in ("../harinote/.env.local", "harinote/.env.local"):
        if os.path.exists(path):
            for line in io.open(path, encoding="utf-8"):
                if line.startswith("TOUR_API_KEY="):
                    return line.split("=", 1)[1].strip()
    sys.exit("TOUR_API_KEY를 찾지 못했습니다 (harinote/.env.local)")


def fetch(key: str, start: date, end: date) -> list[dict]:
    q = urllib.parse.urlencode({
        "serviceKey": key, "MobileOS": "ETC", "MobileApp": "harinote",
        "_type": "json", "numOfRows": 20000, "pageNo": 1,
        "startYmd": start.strftime("%Y%m%d"), "endYmd": end.strftime("%Y%m%d"),
    })
    with urllib.request.urlopen(f"{BASE}?{q}", timeout=60) as r:
        body = json.load(r)["response"]["body"]
    total = int(body.get("totalCount", 0))
    items = body.get("items", {}).get("item", [])
    if total > len(items):
        raise SystemExit(f"페이지 절단: totalCount={total} > 수신={len(items)} — numOfRows를 키우세요")
    return items


key = load_key()
rows: list[dict] = []
cur = START
calls = 0
while cur <= END:
    chunk_end = min(cur + timedelta(days=CHUNK_DAYS - 1), END)
    items = fetch(key, cur, chunk_end)
    calls += 1
    for it in items:
        if not it["signguCode"].startswith(GANGWON_PREFIX):
            continue
        if it["touDivCd"] != "2":  # 외지인만
            continue
        rows.append({
            "sigungu": it["signguNm"],
            "d": f"{it['baseYmd'][:4]}-{it['baseYmd'][4:6]}-{it['baseYmd'][6:]}",
            "visitors": round(float(it["touNum"])),
        })
    print(f"  [{calls:3d}] {cur}~{chunk_end} · 누적 {len(rows)}행")
    cur = chunk_end + timedelta(days=1)
    time.sleep(0.3)  # 예의상 간격

# ── 검증 ──
names = {r["sigungu"] for r in rows}
missing = EXPECTED - names
extra = names - EXPECTED
if missing:
    sys.exit(f"시군 누락: {sorted(missing)} — 패널 병합이 깨진다")
if extra:
    print(f"  ⚠ 예상 밖 시군(무시하지 않음): {sorted(extra)}")
days = {r["d"] for r in rows}
expected_days = (END - START).days + 1
print(f"\n호출 {calls}회 · {len(rows)}행 · 시군 {len(names)}개 · 날짜 {len(days)}/{expected_days}일")
if len(days) < expected_days:
    print(f"  ⚠ 결측일 {expected_days - len(days)}일 — 회귀에서 해당 셀은 offset 결측으로 빠진다")

os.makedirs("data", exist_ok=True)
with io.open(OUT, "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["sigungu", "d", "visitors"])
    w.writeheader()
    w.writerows(sorted(rows, key=lambda r: (r["sigungu"], r["d"])))
v = [r["visitors"] for r in rows]
print(f"일별 외지인 방문자수: 중앙값 {sorted(v)[len(v)//2]:,} · 최소 {min(v):,} · 최대 {max(v):,}")
print(f"저장: {OUT}")
