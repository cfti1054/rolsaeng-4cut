import { describe, expect, it, vi } from 'vitest';
import {
  ExternalApiError,
  type DataDragon,
  type RiotApi,
  type RiotLeagueEntry,
  type SteamApi,
  type SyncJob,
} from '../../src/integrations/contracts';
import { SyncWorker } from '../../src/jobs/sync-worker';
import { FAKE_PUUID, fixture } from '../support/integration-helpers';
import { MemorySyncStore } from '../support/memory-sync-store';

const NOW = new Date('2026-10-28T03:00:00.000Z');
const entries = (name: string): RiotLeagueEntry[] => JSON.parse(fixture(`riot/${name}.json`));

function riotMock(over: Partial<RiotApi> = {}): RiotApi {
  return {
    getAccountByRiotId: vi.fn(),
    getAccountByPuuid: vi.fn(async () => ({ puuid: FAKE_PUUID, gameName: '새이름', tagLine: 'KR1' })),
    getSummonerByPuuid: vi.fn(),
    getLolLeagueEntries: vi.fn(async () => entries('league-lol-gold')),
    getTftLeagueEntries: vi.fn(async () => entries('league-tft')),
    getLolMatchIds: vi.fn(async () => ['KR_9000000001', 'KR_9000000002']),
    getLolMatch: vi.fn(async (id: string) => {
      const m = JSON.parse(fixture(`riot/match-${id}.json`));
      const end = m.info.gameEndTimestamp ?? null;
      return {
        matchId: m.metadata.matchId,
        queueId: m.info.queueId,
        gameDuration: end === null ? m.info.gameDuration / 1000 : m.info.gameDuration,
        gameStartTimestamp: m.info.gameStartTimestamp,
        gameEndTimestamp: end,
        participants: m.info.participants,
      };
    }),
    ...over,
  };
}
const steamMock = (over: Partial<SteamApi> = {}): SteamApi => ({
  getOwnedGames: vi.fn(async () => ({ visibility: 'public' as const, games: [{ appId: 10, name: 'CS', minutesTotal: 5, minutesRecent: 1 }] })),
  getPlayerSummary: vi.fn(async () => ({ personaName: '새스팀이름' })),
  verifyOpenIdAssertion: vi.fn(),
  searchStoreApps: vi.fn(async () => []),
  getStoreApp: vi.fn(async () => null),
  ...over,
});
const ddragon: DataDragon = {
  profileIconUrl: async () => null,
  champion: async (id) => (id === 266 ? { key: 'Aatrox', nameKo: '아트록스', imageUrl: null } : null),
};

function setup(riot = riotMock(), steam = steamMock()) {
  const store = new MemorySyncStore();
  const worker = new SyncWorker(store, riot, steam, ddragon, () => NOW);
  return { store, worker, riot, steam };
}
const job = (kind: SyncJob['kind'], id: string, reason: SyncJob['reason'] = 'manual'): SyncJob => ({ kind, gameAccountId: id, reason, priority: 1 });

describe('SyncWorker riot-full', () => {
  it('이름 갱신 → lol/tft 티어 스냅샷 → 대표면 전적 저장, 성공 시 오류 null', async () => {
    const { store, worker } = setup();
    const { lol, tft } = store.addRiot('u1', FAKE_PUUID);
    expect(await worker.run(job('riot-full', tft!.id))).toBeUndefined(); // tft 행 id 로도 같은 쌍을 처리
    expect(store.row(lol.id).displayName).toBe('새이름#KR1');
    expect(store.row(tft!.id).displayName).toBe('새이름#KR1');
    expect(store.snapshots.map((s) => [s.queue, s.rank.tier, s.rank.division, s.rank.lp])).toEqual([
      ['RANKED_SOLO_5x5', 'GOLD', 'II', 47],
      ['RANKED_TFT', 'PLATINUM', 'IV', 33],
    ]);
    const ms = store.matches.get(lol.id)!;
    expect(ms.map((m) => m.externalMatchId).sort()).toEqual(['KR_9000000001', 'KR_9000000002']);
    const first = ms.find((m) => m.externalMatchId === 'KR_9000000001')!;
    expect(first.summary).toMatchObject({ champion_key: 'Aatrox', position: 'top', kills: 7, duration_sec: 1830, queue_id: 420 });
    expect(first.win).toBe(true);
    const second = ms.find((m) => m.externalMatchId === 'KR_9000000002')!;
    expect(second.summary).toMatchObject({ champion_key: '999999', position: null, duration_sec: 1500 });
    for (const r of [lol, tft!]) {
      const row = store.row(r.id);
      expect(row.syncState).toBe('idle');
      expect(row.lastSyncedAt).toEqual(NOW);
      expect(row.lastSyncError).toBeNull();
    }
    expect(store.row(lol.id).matchesSyncedAt).toEqual(NOW);
  });

  it('부계정(비대표)은 전적을 가져오지 않는다', async () => {
    const { store, worker, riot } = setup();
    const { lol } = store.addRiot('u1', FAKE_PUUID, { primary: false });
    await worker.run(job('riot-full', lol.id));
    expect(riot.getLolMatchIds).not.toHaveBeenCalled();
    expect(store.row(lol.id).matchesSyncedAt).toBeNull();
  });

  it('같은 티어면 새 스냅샷을 만들지 않고, 바뀌면 만든다', async () => {
    const { store, worker, riot } = setup();
    const { lol } = store.addRiot('u1', FAKE_PUUID);
    await worker.run(job('riot-tier', lol.id, 'schedule'));
    store.row(lol.id).syncState = 'idle';
    await worker.run(job('riot-tier', lol.id, 'schedule'));
    expect(store.snapshots.filter((s) => s.queue === 'RANKED_SOLO_5x5')).toHaveLength(1);
    (riot.getLolLeagueEntries as ReturnType<typeof vi.fn>).mockResolvedValueOnce(entries('league-lol-master'));
    store.row(lol.id).syncState = 'idle';
    await worker.run(job('riot-tier', lol.id, 'schedule'));
    const solo = store.snapshots.filter((s) => s.queue === 'RANKED_SOLO_5x5');
    expect(solo).toHaveLength(2);
    expect(solo[1]!.rank).toMatchObject({ tier: 'MASTER', division: null, lp: 120 });
  });

  it('큐 기록이 없으면 UNRANKED 스냅샷', async () => {
    const { store, worker } = setup(riotMock({ getLolLeagueEntries: async () => entries('league-empty') }));
    const { lol } = store.addRiot('u1', FAKE_PUUID);
    await worker.run(job('riot-tier', lol.id, 'schedule'));
    expect(store.snapshots[0]).toMatchObject({ queue: 'RANKED_SOLO_5x5', rank: { tier: 'UNRANKED', division: null, lp: 0, wins: 0, losses: 0 } });
  });

  it('riot-tier 는 이름을 갱신하지 않고 전적도 가져오지 않는다', async () => {
    const { store, worker, riot } = setup();
    const { lol } = store.addRiot('u1', FAKE_PUUID);
    await worker.run(job('riot-tier', lol.id, 'schedule'));
    expect(riot.getAccountByPuuid).not.toHaveBeenCalled();
    expect(riot.getLolMatchIds).not.toHaveBeenCalled();
    expect(store.row(lol.id).displayName).toBe('Old#KR1');
  });

  it('이미 있는 매치는 상세 조회하지 않는다', async () => {
    const { store, worker, riot } = setup();
    const { lol } = store.addRiot('u1', FAKE_PUUID);
    await worker.run(job('riot-matches', lol.id, 'profile-view'));
    store.row(lol.id).syncState = 'idle';
    (riot.getLolMatch as ReturnType<typeof vi.fn>).mockClear();
    await worker.run(job('riot-matches', lol.id, 'profile-view'));
    expect(riot.getLolMatch).not.toHaveBeenCalled();
  });

  it('계정 없음(404) → ACCOUNT_NOT_FOUND 기록, 기존 값 유지', async () => {
    const { store, worker } = setup(riotMock({ getAccountByPuuid: async () => { throw new ExternalApiError('not_found'); } }));
    const { lol } = store.addRiot('u1', FAKE_PUUID);
    store.row(lol.id).lastSyncedAt = new Date('2026-10-20T00:00:00Z');
    await worker.run(job('riot-full', lol.id));
    const r = store.row(lol.id);
    expect(r.lastSyncError).toBe('ACCOUNT_NOT_FOUND');
    expect(r.lastSyncErrorAt).toEqual(NOW);
    expect(r.lastSyncedAt).toEqual(new Date('2026-10-20T00:00:00Z'));
    expect(r.syncState).toBe('idle');
  });

  it('401 → PROVIDER_AUTH_FAILED 이고 뒤 단계를 중단', async () => {
    const { store, worker, riot } = setup(riotMock({ getLolLeagueEntries: async () => { throw new ExternalApiError('auth'); } }));
    const { lol, tft } = store.addRiot('u1', FAKE_PUUID);
    await worker.run(job('riot-tier', lol.id, 'schedule'));
    expect(store.row(lol.id).lastSyncError).toBe('PROVIDER_AUTH_FAILED');
    expect(store.row(tft!.id).lastSyncError).toBe('PROVIDER_AUTH_FAILED');
    expect(riot.getTftLeagueEntries).not.toHaveBeenCalled();
  });

  it('5xx → PROVIDER_UNAVAILABLE 이지만 성공한 다른 단계(tft)는 시각 갱신', async () => {
    const { store, worker } = setup(riotMock({ getLolLeagueEntries: async () => { throw new ExternalApiError('unavailable'); } }));
    const { lol, tft } = store.addRiot('u1', FAKE_PUUID);
    await worker.run(job('riot-tier', lol.id, 'schedule'));
    expect(store.row(lol.id).lastSyncedAt).toBeNull();
    expect(store.row(tft!.id).lastSyncedAt).toEqual(NOW);
    expect(store.row(lol.id).lastSyncError).toBe('PROVIDER_UNAVAILABLE');
  });

  it('키 없음 → PROVIDER_NOT_CONFIGURED, 알 수 없는 tier → INTERNAL_ERROR', async () => {
    const a = setup(riotMock({ getLolLeagueEntries: async () => { throw new ExternalApiError('not_configured'); } }));
    const la = a.store.addRiot('u1', FAKE_PUUID).lol;
    await a.worker.run(job('riot-tier', la.id, 'schedule'));
    expect(a.store.row(la.id).lastSyncError).toBe('PROVIDER_NOT_CONFIGURED');

    const b = setup(riotMock({ getLolLeagueEntries: async () => [{ queueType: 'RANKED_SOLO_5x5', tier: 'WOOD', rank: 'I', leaguePoints: 0, wins: 0, losses: 0 }] }));
    const lb = b.store.addRiot('u1', FAKE_PUUID).lol;
    await b.worker.run(job('riot-tier', lb.id, 'schedule'));
    expect(b.store.row(lb.id).lastSyncError).toBe('INTERNAL_ERROR');
  });

  it('429: 1·2번째는 queued 로 되돌리고 retryAfterSec 반환, 3번째는 PROVIDER_RATE_LIMITED 기록', async () => {
    const rl = riotMock({ getLolLeagueEntries: async () => { throw new ExternalApiError('rate_limited', '429', { retryAfterSec: 9 }); } });
    const { store, worker } = setup(rl);
    const { lol } = store.addRiot('u1', FAKE_PUUID);
    expect(await worker.run(job('riot-tier', lol.id, 'schedule'), { rateLimitedCount: 0 })).toEqual({ retryAfterSec: 9 });
    expect(store.row(lol.id).syncState).toBe('queued');
    expect(store.row(lol.id).lastSyncError).toBeNull();
    expect(await worker.run(job('riot-tier', lol.id, 'schedule'), { rateLimitedCount: 1 })).toEqual({ retryAfterSec: 9 });
    expect(await worker.run(job('riot-tier', lol.id, 'schedule'), { rateLimitedCount: 2 })).toBeUndefined();
    expect(store.row(lol.id).syncState).toBe('idle');
    expect(store.row(lol.id).lastSyncError).toBe('PROVIDER_RATE_LIMITED');
  });

  it('다른 작업자가 실행 중이면(claim 실패) 건너뛴다', async () => {
    const { store, worker, riot } = setup();
    const { lol, tft } = store.addRiot('u1', FAKE_PUUID);
    for (const r of [lol, tft!]) {
      store.row(r.id).syncState = 'running';
      store.row(r.id).syncStateAt = new Date(NOW.getTime() - 60_000);
    }
    await worker.run(job('riot-tier', lol.id, 'schedule'));
    expect(riot.getLolLeagueEntries).not.toHaveBeenCalled();
  });

  it('10분 넘게 멈춘 running 행은 작업자가 다시 잡는다(running→running)', async () => {
    const { store, worker, riot } = setup();
    const { lol, tft } = store.addRiot('u1', FAKE_PUUID);
    for (const r of [lol, tft!]) {
      store.row(r.id).syncState = 'running';
      store.row(r.id).syncStateAt = new Date(NOW.getTime() - 11 * 60_000);
    }
    await worker.run(job('riot-tier', lol.id, 'schedule'));
    expect(riot.getLolLeagueEntries).toHaveBeenCalled();
    expect(store.row(lol.id).syncState).toBe('idle');
  });

  it('해제된 계정이면 아무것도 하지 않는다', async () => {
    const { worker, riot } = setup();
    expect(await worker.run(job('riot-full', 'gone'))).toBeUndefined();
    expect(riot.getAccountByPuuid).not.toHaveBeenCalled();
  });
});

describe('SyncWorker steam-playtime', () => {
  it('수동: 이름 갱신 + 플레이타임 저장 + last_synced_at', async () => {
    const { store, worker } = setup();
    const s = store.addSteam('u1', '76561190000000001');
    await worker.run(job('steam-playtime', s.id, 'link'));
    expect(store.row(s.id).displayName).toBe('새스팀이름');
    expect(store.playtime.get(s.id)).toEqual([{ appId: 10, appName: 'CS', minutesTotal: 5, minutesRecent: 1 }]);
    expect(store.row(s.id).lastSyncedAt).toEqual(NOW);
    expect(store.row(s.id).lastSyncError).toBeNull();
  });

  it('주기 작업은 GetOwnedGames만 호출', async () => {
    const { store, worker, steam } = setup();
    const s = store.addSteam('u1', '76561190000000001');
    await worker.run(job('steam-playtime', s.id, 'schedule'));
    expect(steam.getPlayerSummary).not.toHaveBeenCalled();
  });

  it('비공개 프로필: STEAM_PROFILE_PRIVATE 기록, 기존 플레이타임·last_synced_at 유지', async () => {
    const { store, worker } = setup(riotMock(), steamMock({ getOwnedGames: async () => ({ visibility: 'private' }) }));
    const s = store.addSteam('u1', '76561190000000001');
    const old = [{ appId: 1, appName: 'Old', minutesTotal: 9, minutesRecent: 0 }];
    store.playtime.set(s.id, old);
    store.row(s.id).lastSyncedAt = new Date('2026-10-20T00:00:00Z');
    await worker.run(job('steam-playtime', s.id, 'schedule'));
    expect(store.row(s.id).lastSyncError).toBe('STEAM_PROFILE_PRIVATE');
    expect(store.row(s.id).lastSyncedAt).toEqual(new Date('2026-10-20T00:00:00Z'));
    expect(store.playtime.get(s.id)).toBe(old);
  });

  it('이름 조회 실패는 무시하고 플레이타임은 저장, 0개 공개는 성공', async () => {
    const { store, worker } = setup(
      riotMock(),
      steamMock({
        getPlayerSummary: async () => { throw new ExternalApiError('unavailable'); },
        getOwnedGames: async () => ({ visibility: 'public', games: [] }),
      }),
    );
    const s = store.addSteam('u1', '76561190000000001');
    await worker.run(job('steam-playtime', s.id, 'manual'));
    expect(store.row(s.id).lastSyncError).toBeNull();
    expect(store.row(s.id).lastSyncedAt).toEqual(NOW);
    expect(store.playtime.get(s.id)).toEqual([]);
  });

  it('스팀 429 도 재등록 요청', async () => {
    const { store, worker } = setup(riotMock(), steamMock({ getOwnedGames: async () => { throw new ExternalApiError('rate_limited', '429', { retryAfterSec: 30 }); } }));
    const s = store.addSteam('u1', '76561190000000001');
    expect(await worker.run(job('steam-playtime', s.id, 'schedule'))).toEqual({ retryAfterSec: 30 });
  });
});
