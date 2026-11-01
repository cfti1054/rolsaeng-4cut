import { describe, expect, it } from 'vitest';
import type { SyncJob } from '../../src/integrations/contracts';
import { HostRateLimiter } from '../../src/integrations/rate-limiter';
import { SteamHttpApi } from '../../src/integrations/steam/steam-client';
import { SyncWorker } from '../../src/jobs/sync-worker';
import type { SteamGameRow } from '../../src/jobs/sync-store';
import { fakeClock, fakeFetch, fixture, testOptions } from '../support/integration-helpers';
import { MemorySyncStore } from '../support/memory-sync-store';

const NOW = new Date('2026-10-30T20:00:00.000Z'); // 05:00 KST
const STEAM_ID = '76561190000000001';

/** 저장소 호출 인자(synced_at)를 기록한다 */
class RecordingStore extends MemorySyncStore {
  calls: { id: string; games: SteamGameRow[]; syncedAt: Date }[] = [];
  override async replaceSteamPlaytime(id: string, games: SteamGameRow[], syncedAt?: Date): Promise<void> {
    this.calls.push({ id, games, syncedAt: syncedAt as Date });
    await super.replaceSteamPlaytime(id, games);
  }
}

function setup(routes: Parameters<typeof fakeFetch>[0]) {
  const clock = fakeClock();
  const limiter = new HostRateLimiter(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, clock);
  const steam = new SteamHttpApi(testOptions(), limiter, fakeFetch(routes), clock);
  const store = new RecordingStore();
  const worker = new SyncWorker(store, { } as never, steam, { } as never, () => NOW);
  return { store, worker };
}
const job = (id: string): SyncJob => ({ kind: 'steam-playtime', gameAccountId: id, reason: 'schedule', priority: 1 });

describe('스팀 하루 1회 배치 (D225, 플레이타임 랭킹 입력)', () => {
  it('fixture(GetOwnedGames 공개) -> steam_playtime 의 app_name·minutes_total·minutes_recent·synced_at 이 채워진다', async () => {
    const { store, worker } = setup({ GetOwnedGames: { body: fixture('steam/owned-games-public.json') } });
    const s = store.addSteam('u1', STEAM_ID);
    await worker.run(job(s.id));
    expect(store.calls).toHaveLength(1);
    const call = store.calls[0]!;
    expect(call.syncedAt).toEqual(NOW);
    expect(call.games.length).toBeGreaterThan(0);
    for (const g of call.games) {
      expect(Number.isInteger(g.appId)).toBe(true);
      expect(typeof g.appName).toBe('string');
      expect(Number.isInteger(g.minutesTotal)).toBe(true);
      expect(Number.isInteger(g.minutesRecent)).toBe(true);
    }
    expect(store.row(s.id).lastSyncedAt).toEqual(NOW);
    expect(store.row(s.id).lastSyncError).toBeNull();
  });

  it('fixture(비공개) -> STEAM_PROFILE_PRIVATE, steam_playtime 쓰기 없음(값 유지)', async () => {
    const { store, worker } = setup({ GetOwnedGames: { body: fixture('steam/owned-games-private.json') } });
    const s = store.addSteam('u1', STEAM_ID);
    await worker.run(job(s.id));
    expect(store.calls).toHaveLength(0);
    expect(store.row(s.id).lastSyncError).toBe('STEAM_PROFILE_PRIVATE');
  });
});
