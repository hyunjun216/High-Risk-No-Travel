/**
 * 중기예보 스모크 — 실행: npx tsx scripts/check-mid-forecast.ts
 *
 * 18개 시군 × D+4~10을 실호출해 예보구역코드 매핑과 응답 파싱을 검증한다.
 * regId를 잘못 매핑하면 "속초 여행인데 철원 기온"이 되므로, 영동·영서 기온 차이가
 * 지리와 맞는지까지 눈으로 확인할 수 있게 출력한다.
 * 키는 KMA_API_KEY. 값은 절대 출력하지 않는다.
 */
import { fetchMidDailyWeather, MID_MAX_OFFSET, MID_MIN_OFFSET } from "../src/lib/risk/kma-mid";
import { SIGUNGU_SEATS } from "../src/lib/risk/regions";

try {
  process.loadEnvFile(".env.local");
} catch {
  console.log("[i] .env.local이 없습니다 — 셸 환경변수만 사용합니다.");
}

/** 오늘 + n일 (KST) */
function plusDaysISO(n: number): string {
  const kstNow = new Date(Date.now() + 9 * 3600_000);
  kstNow.setUTCDate(kstNow.getUTCDate() + n);
  return kstNow.toISOString().slice(0, 10);
}

const YEONGDONG = new Set([1, 2, 3, 4, 5, 7, 14]);

async function main(): Promise<void> {
  // 18시 발표는 D+4를 주지 않으므로 두 발표 모두에서 유효한 D+5로 확인한다
  const target = plusDaysISO(MID_MIN_OFFSET + 1);
  console.log(`[1] 18개 시군 × D+${MID_MIN_OFFSET + 1} (${target}) 조회\n`);
  console.log("  시군        구분   최저~최고    강수%  일조h");

  let ok = 0;
  const temps: { name: string; east: boolean; tmax: number }[] = [];
  for (const [codeStr, seat] of Object.entries(SIGUNGU_SEATS)) {
    const code = Number(codeStr);
    const w = await fetchMidDailyWeather(code, target);
    if (!w) {
      console.log(`  ${seat.name.padEnd(10)} 조회 실패`);
      continue;
    }
    ok += 1;
    const east = YEONGDONG.has(code);
    temps.push({ name: seat.name, east, tmax: w.tempC });
    console.log(
      `  ${seat.name.padEnd(10)} ${east ? "영동" : "영서"}   ` +
        `${String(w.tminC).padStart(4)}~${String(w.tempC).padStart(3)}℃   ` +
        `${String(w.rainProbPct ?? "-").padStart(4)}   ${String(w.sunHours ?? "-").padStart(4)}`,
    );
  }
  console.log(`\n  성공 ${ok}/18개 시군`);

  // 매핑 온전성: 영서 내륙이 영동 해안보다 여름엔 덥고 겨울엔 춥다.
  // 코드가 뒤섞였다면 이 대비가 무너진다.
  const east = temps.filter((t) => t.east).map((t) => t.tmax);
  const west = temps.filter((t) => !t.east).map((t) => t.tmax);
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  if (east.length && west.length) {
    console.log(
      `\n[2] 매핑 온전성 — 영서 평균 최고 ${avg(west).toFixed(1)}℃ · 영동 평균 최고 ${avg(east).toFixed(1)}℃`,
    );
    console.log("    (여름엔 영서가 더 덥고 겨울엔 더 추운 것이 정상 — 뒤바뀌면 코드 매핑 의심)");
  }

  // 하한은 발표시각에 따라 다르다 — 06시 발표는 D+4부터, 18시 발표는 D+5부터.
  // 상한 밖(D+11)은 반드시 null이어야 하고, 그 안은 null이어도 계절 모드로 폴백하니 정상이다.
  console.log(`\n[3] 범위 경계 확인 (속초 기준)`);
  for (const n of [3, MID_MIN_OFFSET, 5, MID_MAX_OFFSET, MID_MAX_OFFSET + 1]) {
    const w = await fetchMidDailyWeather(5, plusDaysISO(n));
    const mustBeNull = n > MID_MAX_OFFSET;
    const bad = mustBeNull && w !== null;
    console.log(
      `    D+${String(n).padStart(2)} → ${w ? "예보 있음" : "null(계절 모드 폴백)"}` +
        (bad ? " ✗ 상한 밖인데 값이 왔다" : " ✓"),
    );
  }
}

main().catch((e) => {
  console.error("실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
