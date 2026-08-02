# -*- coding: utf-8 -*-
# 05_verify_engine.py — 포팅한 엔진이 원본(vitest score.test.ts)의 경계 속성을 재현하는지 검증
#
# ⚠️ 이 검증은 2026-07-10 시점(v1) 기준이다. safety_engine.py 헤더 참조 —
#    현행 엔진은 산불 밴드·산사태 축·쾌적층 구조가 모두 다르므로, 여기서 20/20이
#    통과하는 것이 "현행 엔진과 일치"를 뜻하지 않는다.
from safety_engine import compute_safety_score

CLEAR = {"tempC": 24, "rainProbPct": 10, "windMs": 2, "pm25": 10,
         "forestFireLevel": 1, "emergencyRoomKm": 3}

def run(env="outdoor_general", profile="default", **over):
    return compute_safety_score({**CLEAR, **over}, env, profile)

checks = []
def check(name, cond):
    checks.append((name, cond))
    print(("PASS " if cond else "FAIL "), name)

# 기본/구조
check("쾌청 실내 90점 이상", run("indoor")["score"] >= 90)
check("쾌청 일반야외 90점 이상", run()["score"] >= 90)

# heat 경계 (원본 테스트와 동일 속성)
check("32.9℃ < 33.0℃ 감점", run(tempC=32.9)["heat"] < run(tempC=33.0)["heat"])
check("33.0℃ 주의보 진입 ≥10점", run(tempC=33.0)["heat"] >= 10)
check("35.0℃ 경보 ≥22점", run(tempC=35.0)["heat"] >= 22)
check("36℃ > 35℃, ≤25", run(tempC=36)["heat"] > run(tempC=35)["heat"] and run(tempC=36)["heat"] <= 25)
check("39℃ 상한 25 clamp", run(tempC=39)["heat"] == 25)
check("실내 35℃는 야외의 절반 미만", run("indoor", tempC=35)["heat"] < run(tempC=35)["heat"] * 0.5)
check("with_kids heat ×1.3", run(profile="with_kids", tempC=34)["heat"] == round(run(tempC=34)["heat"] * 1.3))

# rain_wind 경계
check("강수 29% = 0, 30% > 0", run(rainProbPct=29)["rain_wind"] == 0 and run(rainProbPct=30)["rain_wind"] > 0)
check("60% > 59%", run(rainProbPct=60)["rain_wind"] > run(rainProbPct=59)["rain_wind"])
check("풍속 14.0 > 13.9", run(windMs=14.0)["rain_wind"] > run(windMs=13.9)["rain_wind"])
check("계곡 강수80% > 일반, 점수 낮음",
      run("outdoor_water", rainProbPct=80)["rain_wind"] > run(rainProbPct=80)["rain_wind"]
      and run("outdoor_water", rainProbPct=80)["score"] < run(rainProbPct=80)["score"])
check("해안 강풍 ×1.5", run("outdoor_coast", windMs=15)["rain_wind"] == round(run(windMs=15)["rain_wind"] * 1.5))

# pm / fire / medical
check("PM 15=0, 16=3, 36=8, 76=15",
      run(pm25=15)["pm"] == 0 and run(pm25=16)["pm"] == 3
      and run(pm25=36)["pm"] == 8 and run(pm25=76)["pm"] == 15)
check("산불 4단계 = 20점", run(forestFireLevel=4)["fire"] == 20)
check("산악 산불 3단계 ×1.3 (12→16)", run("outdoor_mountain", forestFireLevel=3)["fire"] == round(12 * 1.3))
check("의료 30km+ = 10점", run(emergencyRoomKm=35)["medical"] == 10)
check("with_seniors 의료 ×1.5 (상한 clamp)",
      run(profile="with_seniors", emergencyRoomKm=25)["medical"]
      == min(10, round((5 + 5 / 10 * 5) * 1.5)))

# 극단 입력: score 0 고정
extreme = run("outdoor_water", tempC=40, rainProbPct=95, rainMm=80, windMs=20,
              pm25=90, forestFireLevel=4, emergencyRoomKm=40, shelterKm=8)
check("극단 입력 score=0 clamp", extreme["score"] == 0)

fails = [n for n, c in checks if not c]
print(f"\n{len(checks) - len(fails)}/{len(checks)} 통과" + (f" — 실패: {fails}" if fails else " — 엔진 포팅 검증 완료"))
