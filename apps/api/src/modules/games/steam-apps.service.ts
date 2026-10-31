import { Inject, Injectable } from '@nestjs/common';
import {
  STEAM_APP_SEARCH_LIMIT,
  SearchSteamAppsResponse,
  type SteamAppOption,
  type SteamAppRef,
} from '@gcd/shared';
import { Prisma } from '@prisma/client';
import { APP_CLOCK, type Clock } from '../../common/clock';
import { ExternalApiError, STEAM_API, type SteamApi, type SteamStoreApp } from '../../integrations/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { toProviderAppError } from '../game-accounts/external-errors';
import { playtimeHolderWhereSql, playtimeHoldersFromSql } from '../rankings/playtime-holders';

const STORE_CACHE_TTL_MS = 10 * 60_000;
const STORE_CACHE_MAX = 200;
const KNOWN_NAMES_MAX = 2_000;
/** 검색어가 있을 때 멤버 보유 게임을 앞에 몇 개까지 둘지(나머지 자리는 상점 결과) */
const OWNED_WITH_QUERY_MAX = 10;

type OwnedRow = { app_id: number; owner_count: unknown; name: string };

/** ILIKE 패턴 이스케이프(`\`·`%`·`_`). PostgreSQL LIKE 기본 이스케이프 문자는 `\` */
export function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * 스팀 내전 게임 검색·이름 결정(D98, S5 D234).
 * 멤버 보유 게임 = 플레이타임 「보유자」(rankings/playtime-holders.ts, 플레이타임 랭킹과 같은 조건)의 app별 수,
 * 그 밖은 스팀 상점 검색(키 불필요)을 쓴다.
 * 상점 검색 결과는 검색어별로 10분 캐시하고, 거기서 본 이름은 작성 때 이름 결정에 다시 쓴다(상점 재호출 없이).
 */
@Injectable()
export class SteamAppsService {
  private readonly storeCache = new Map<string, { at: number; items: SteamStoreApp[] }>();
  private readonly knownNames = new Map<number, string>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STEAM_API) private readonly steam: SteamApi,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  /** GET /steam-apps?q= */
  async search(q: string): Promise<SearchSteamAppsResponse> {
    if (q === '') {
      const owned = await this.owned({ take: STEAM_APP_SEARCH_LIMIT });
      return SearchSteamAppsResponse.parse({ items: owned, store_unavailable: false });
    }
    const owned = await this.owned({ q, take: OWNED_WITH_QUERY_MAX });
    let store: SteamStoreApp[] = [];
    let storeUnavailable = false;
    try {
      store = await this.searchStore(q);
    } catch (err) {
      if (!(err instanceof ExternalApiError)) throw err;
      storeUnavailable = true;
    }
    const seen = new Set(owned.map((o) => o.app_id));
    const extra = store.filter((s) => !seen.has(s.appId)).slice(0, STEAM_APP_SEARCH_LIMIT - owned.length);
    const counts = await this.ownerCounts(extra.map((s) => s.appId));
    const items: SteamAppOption[] = [
      ...owned,
      ...extra.map((s) => ({ app_id: s.appId, name: s.name, owner_count: counts.get(s.appId) ?? 0 })),
    ];
    return SearchSteamAppsResponse.parse({ items, store_unavailable: storeUnavailable });
  }

  /**
   * 작성·수정 때 app id → 저장할 이름. 멤버 보유 게임 이름 → 최근 상점 검색에서 본 이름 → 상점 조회 순.
   * 상점에 없는 id → null(호출부가 VALIDATION_FAILED). 상점 오류 → GAME_PROVIDER_* AppError
   */
  async resolve(appId: number): Promise<SteamAppRef | null> {
    const owned = await this.prisma.steamPlaytime.findFirst({
      where: { appId, appName: { not: null } },
      orderBy: { syncedAt: 'desc' },
    });
    if (owned?.appName) return { app_id: appId, name: owned.appName };
    const known = this.knownNames.get(appId);
    if (known) return { app_id: appId, name: known };
    try {
      const app = await this.steam.getStoreApp(appId);
      return app ? { app_id: appId, name: app.name } : null;
    } catch (err) {
      if (err instanceof ExternalApiError && err.kind === 'not_found') return null;
      throw toProviderAppError(err, 'NOT_FOUND');
    }
  }

  /**
   * 7-4 보유 게임: 보유자가 있는 app, 보유자 수 DESC → app_id ASC. name = 보유자 행 app_name 중 null·빈 문자열이 아닌 값,
   * synced_at 최신 우선(플레이타임 랭킹 app.name과 같은 규칙). 이름이 없는 app은 뺀다. q가 있으면 그 name이 q를 포함(대소문자 무시).
   */
  private async owned(opts: { q?: string; take: number }): Promise<SteamAppOption[]> {
    const nameFilter = opts.q ? Prisma.sql`AND h.name ILIKE ${likeContains(opts.q)}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<OwnedRow[]>`
      /* gcd:steam-apps-owned */
      SELECT h.app_id, h.owner_count, h.name
      FROM (
        SELECT sp.app_id, COUNT(*)::int AS owner_count,
          (ARRAY_AGG(sp.app_name ORDER BY sp.synced_at DESC) FILTER (WHERE sp.app_name IS NOT NULL AND sp.app_name <> ''))[1] AS name
        FROM ${playtimeHoldersFromSql}
        WHERE ${playtimeHolderWhereSql}
        GROUP BY sp.app_id
      ) h
      WHERE h.name IS NOT NULL ${nameFilter}
      ORDER BY h.owner_count DESC, h.app_id ASC
      LIMIT ${opts.take}`;
    return rows.map((r) => ({ app_id: Number(r.app_id), name: r.name, owner_count: Number(r.owner_count) }));
  }

  /** 7-4 상점 결과 owner_count: 같은 보유자 조건의 수(없으면 호출부가 0) */
  private async ownerCounts(appIds: number[]): Promise<Map<number, number>> {
    if (appIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<{ app_id: number; owner_count: unknown }[]>`
      /* gcd:steam-apps-owner-counts */
      SELECT sp.app_id, COUNT(*)::int AS owner_count
      FROM ${playtimeHoldersFromSql}
      WHERE ${playtimeHolderWhereSql} AND sp.app_id IN (${Prisma.join(appIds)})
      GROUP BY sp.app_id`;
    return new Map(rows.map((r) => [Number(r.app_id), Number(r.owner_count)]));
  }

  private async searchStore(q: string): Promise<SteamStoreApp[]> {
    const key = q.toLowerCase();
    const now = this.clock.now().getTime();
    const hit = this.storeCache.get(key);
    if (hit && now - hit.at < STORE_CACHE_TTL_MS) return hit.items;
    const items = await this.steam.searchStoreApps(q);
    this.storeCache.delete(key);
    this.storeCache.set(key, { at: now, items });
    trim(this.storeCache, STORE_CACHE_MAX);
    for (const i of items) {
      this.knownNames.delete(i.appId);
      this.knownNames.set(i.appId, i.name);
    }
    trim(this.knownNames, KNOWN_NAMES_MAX);
    return items;
  }
}

/** Map을 삽입 순서 기준으로 오래된 것부터 지워 max개로 */
function trim<K, V>(m: Map<K, V>, max: number): void {
  for (const k of m.keys()) {
    if (m.size <= max) return;
    m.delete(k);
  }
}
