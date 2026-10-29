import { type RankValue, type RankedQueue, SYNC_STATE_STALE_MS } from '@gcd/shared';
import type {
  MatchRow,
  ProducerTarget,
  RowRelease,
  SteamGameRow,
  SyncAccountRow,
  SyncStore,
  SyncTarget,
} from '../../src/jobs/sync-store';

export type MemRow = SyncAccountRow & {
  game: 'lol' | 'tft' | 'steam';
  syncState: 'idle' | 'queued' | 'running';
  syncStateAt: Date;
  lastSyncedAt: Date | null;
  matchesSyncedAt: Date | null;
  lastSyncError: string | null;
  lastSyncErrorAt: Date | null;
};

/** DB 없이 작업자 로직을 검증하는 SyncStore 구현. 상태 전이는 shared 전이 맵과 같은 규칙만 허용한다 */
export class MemorySyncStore implements SyncStore {
  rows: MemRow[] = [];
  snapshots: { accountId: string; queue: RankedQueue; rank: RankValue; at: Date }[] = [];
  matches = new Map<string, (MatchRow & { accountId: string })[]>();
  playtime = new Map<string, SteamGameRow[]>();
  tierTargets: ProducerTarget[] = [];
  steamTargets: ProducerTarget[] = [];
  lockHeld = false;

  addRiot(userId: string, puuid: string, o: { primary?: boolean; name?: string; tft?: boolean } = {}): { lol: MemRow; tft: MemRow | null } {
    const mk = (game: 'lol' | 'tft'): MemRow => ({
      id: `${game}-${this.rows.length + 1}`,
      userId,
      externalId: puuid,
      displayName: o.name ?? 'Old#KR1',
      isPrimary: o.primary ?? true,
      game,
      syncState: 'queued',
      syncStateAt: new Date(0),
      lastSyncedAt: null,
      matchesSyncedAt: null,
      lastSyncError: null,
      lastSyncErrorAt: null,
    });
    const lol = mk('lol');
    this.rows.push(lol);
    let tft: MemRow | null = null;
    if (o.tft !== false) {
      tft = mk('tft');
      this.rows.push(tft);
    }
    return { lol, tft };
  }

  addSteam(userId: string, steamId: string): MemRow {
    const r: MemRow = {
      id: `steam-${this.rows.length + 1}`,
      userId,
      externalId: steamId,
      displayName: '스팀 사용자',
      isPrimary: true,
      game: 'steam',
      syncState: 'queued',
      syncStateAt: new Date(0),
      lastSyncedAt: null,
      matchesSyncedAt: null,
      lastSyncError: null,
      lastSyncErrorAt: null,
    };
    this.rows.push(r);
    return r;
  }

  row(id: string): MemRow {
    const r = this.rows.find((x) => x.id === id);
    if (!r) throw new Error(`no row ${id}`);
    return r;
  }

  async loadTarget(id: string): Promise<SyncTarget | null> {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return null;
    const pub = (x: MemRow | undefined): SyncAccountRow | null =>
      x ? { id: x.id, userId: x.userId, externalId: x.externalId, displayName: x.displayName, isPrimary: x.isPrimary } : null;
    if (r.game === 'steam') return { provider: 'steam', steam: pub(r) as SyncAccountRow };
    const pair = this.rows.filter((x) => x.userId === r.userId && x.externalId === r.externalId && x.game !== 'steam');
    return { provider: 'riot', lol: pub(pair.find((x) => x.game === 'lol')), tft: pub(pair.find((x) => x.game === 'tft')) };
  }

  async claim(ids: string[], now: Date): Promise<boolean> {
    let n = 0;
    for (const id of ids) {
      const r = this.row(id);
      if (r.syncState !== 'running' || now.getTime() - r.syncStateAt.getTime() >= SYNC_STATE_STALE_MS) {
        r.syncState = 'running';
        r.syncStateAt = now;
        n++;
      }
    }
    return n > 0;
  }

  async release(rows: RowRelease[], error: string | null, now: Date): Promise<void> {
    for (const rel of rows) {
      const r = this.rows.find((x) => x.id === rel.id);
      if (!r) continue;
      if (r.syncState !== 'running') throw new Error(`전이 위반 ${r.syncState} → idle`);
      r.syncState = 'idle';
      r.syncStateAt = now;
      r.lastSyncError = error;
      r.lastSyncErrorAt = error ? now : null;
      if (rel.lastSyncedAt) r.lastSyncedAt = rel.lastSyncedAt;
      if (rel.matchesSyncedAt) r.matchesSyncedAt = rel.matchesSyncedAt;
    }
  }

  async requeue(ids: string[]): Promise<void> {
    for (const id of ids) this.row(id).syncState = 'queued';
  }

  async updateDisplayName(ids: string[], name: string): Promise<void> {
    for (const id of ids) this.row(id).displayName = name;
  }

  async latestSnapshot(accountId: string, queue: RankedQueue): Promise<RankValue | null> {
    const s = this.snapshots.filter((x) => x.accountId === accountId && x.queue === queue).at(-1);
    return s ? s.rank : null;
  }

  async insertSnapshot(accountId: string, queue: RankedQueue, rank: RankValue, at: Date): Promise<void> {
    this.snapshots.push({ accountId, queue, rank, at });
  }

  async existingMatchIds(accountId: string, ids: string[]): Promise<Set<string>> {
    const have = new Set((this.matches.get(accountId) ?? []).map((m) => m.externalMatchId));
    return new Set(ids.filter((i) => have.has(i)));
  }

  async upsertMatch(accountId: string, m: MatchRow): Promise<void> {
    const list = (this.matches.get(accountId) ?? []).filter((x) => x.externalMatchId !== m.externalMatchId);
    list.push({ ...m, accountId });
    this.matches.set(accountId, list);
  }

  async trimMatches(accountId: string, keep: number): Promise<void> {
    const list = (this.matches.get(accountId) ?? []).sort((a, b) => b.playedAt.getTime() - a.playedAt.getTime());
    this.matches.set(accountId, list.slice(0, keep));
  }

  async replaceSteamPlaytime(accountId: string, games: SteamGameRow[]): Promise<void> {
    this.playtime.set(accountId, games);
  }

  async withProducerLock(_key: number, fn: () => Promise<void>): Promise<boolean> {
    if (this.lockHeld) return false;
    await fn();
    return true;
  }
  async selectTierTargets(): Promise<ProducerTarget[]> {
    return this.tierTargets;
  }
  async selectSteamTargets(): Promise<ProducerTarget[]> {
    return this.steamTargets;
  }
  async selectStuck(now: Date) {
    return this.rows
      .filter((r) => r.game !== 'tft' && r.syncState !== 'idle' && now.getTime() - r.syncStateAt.getTime() >= SYNC_STATE_STALE_MS)
      .map((r) => ({ id: r.id, kind: r.game === 'steam' ? ('steam-playtime' as const) : ('riot-full' as const) }));
  }
  async selectQueued() {
    return this.rows
      .filter((r) => r.game !== 'tft' && r.syncState === 'queued')
      .map((r) => ({ id: r.id, kind: r.game === 'steam' ? ('steam-playtime' as const) : ('riot-full' as const) }));
  }
  async requeueStuck(ids: string[], now: Date): Promise<void> {
    for (const id of ids) {
      const base = this.row(id);
      for (const r of this.rows.filter((x) => x.userId === base.userId && x.externalId === base.externalId)) {
        if (r.syncState !== 'idle' && now.getTime() - r.syncStateAt.getTime() >= SYNC_STATE_STALE_MS) {
          r.syncState = 'queued';
          r.syncStateAt = now;
        }
      }
    }
  }
}
