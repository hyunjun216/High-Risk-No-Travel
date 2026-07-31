/**
 * 숙박 + 안전점수 목록 — 목록 페이지 "숙박" 탭 전용.
 * 서버 전용 모듈 — 클라이언트 컴포넌트에서 import 금지.
 * 점수 규칙은 관광지 목록과 동일: 오늘=실황, 단일 날짜=그날 대표점수,
 * 기간=최악일 대표점수. 점수를 못 만든 곳은 제외한다
 * (코스 추천의 숙소 채점과 같은 규칙 — fill-slots-action 참고).
 */
import { cache } from "react";
import {
  getDateSafety,
  getRangeSafety,
  getSpotSafety,
  type PlaceWithSafety,
} from "@/lib/datasource";
import type { Profile } from "@/lib/safety/types";
import { getLodgings } from "@/lib/tour/lodging";

/** 캐시 — 관광지 목록의 날짜별 캐시(datasource.ts)와 같은 10분 TTL, 키 수만 축소 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_KEYS = 4;
const cacheStore = new Map<
  string,
  { data: PlaceWithSafety[]; expiresAt: number }
>();

/** 내장 숙박 전체 + 안전점수 — date 없으면 오늘, end까지 있으면 기간(최악일) 기준 */
export const getLodgingsWithSafety = cache(
  async (
    profile: Profile,
    date?: string,
    end?: string,
  ): Promise<PlaceWithSafety[]> => {
    const key = `${profile}:${date ?? ""}~${end ?? ""}`;
    const hit = cacheStore.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.data;

    const scored = await Promise.all(
      getLodgings().map(async (l) => {
        const breakdown = date
          ? end
            ? (await getRangeSafety(l, profile, date, end))?.worst.breakdown ?? null
            : (await getDateSafety(l, profile, date))?.breakdown ?? null
          : await getSpotSafety(l, profile);
        return breakdown ? ({ ...l, safety: breakdown } as PlaceWithSafety) : null;
      }),
    );
    const data = scored.filter((l): l is PlaceWithSafety => l !== null);

    if (cacheStore.size >= CACHE_MAX_KEYS) {
      const oldest = cacheStore.keys().next().value;
      if (oldest !== undefined) cacheStore.delete(oldest);
    }
    cacheStore.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  },
);
