import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncJob } from '../../src/integrations/contracts';
import { InProcessSyncQueue, dedupeKey, jobPriority } from '../../src/jobs/in-process-queue';
import { SyncScheduler } from '../../src/jobs/sync-scheduler';
import { MemorySyncStore } from '../support/memory-sync-store';

const j = (kind: SyncJob['kind'], id: string, priority: number, reason: SyncJob['reason'] = 'schedule'): SyncJob => ({ kind, gameAccountId: id, reason, priority });

afterEach(() => vi.useRealTimers());

describe('InProcessSyncQueue', () => {
  it('start 전에 쌓인 작업은 우선순위 → 등록 순으로 처리, 제공자별 동시 1', async () => {
    const q = new InProcessSyncQueue();
    await q.enqueue(j('riot-tier', 'a', 4));
    await q.enqueue(j('riot-tier', 'b', 3));
    await q.enqueue(j('riot-full', 'c', 1, 'manual'));
    await q.enqueue(j('riot-tier', 'd', 3));
    await q.enqueue(j('steam-playtime', 's', 5));
    const order: string[] = [];
    let riotActive = 0;
    let maxRiot = 0;
    q.start(async (job) => {
      if (job.kind !== 'steam-playtime') {
        riotActive++;
        maxRiot = Math.max(maxRiot, riotActive);
      }
      order.push(job.gameAccountId);
      await new Promise((r) => setTimeout(r, 1));
      if (job.kind !== 'steam-playtime') riotActive--;
      return undefined;
    });
    await q.onIdle();
    expect(order.filter((x) => x !== 's')).toEqual(['c', 'b', 'd', 'a']);
    expect(order).toContain('s');
    expect(maxRiot).toBe(1);
  });

  it('같은 키는 대기·실행 중 모두 중복 제거, manual 은 별도 키', async () => {
    const q = new InProcessSyncQueue();
    const calls: string[] = [];
    let release!: () => void;
    q.start(async (job) => {
      calls.push(`${job.reason}:${job.gameAccountId}`);
      await new Promise<void>((r) => (release = r));
      return undefined;
    });
    await q.enqueue(j('riot-tier', 'a', 4));
    await q.enqueue(j('riot-tier', 'a', 4)); // 실행 중 중복
    await q.enqueue(j('riot-tier', 'a', 3, 'recovery')); // 같은 kind → 같은 키
    await q.enqueue(j('riot-full', 'a', 1, 'manual')); // 별도 키(대기)
    await q.enqueue(j('riot-full', 'a', 1, 'link')); // manual 키와 같아 무시
    expect(q.pendingKeys()).toEqual(['manual-a']);
    release();
    await new Promise((r) => setTimeout(r, 5));
    release();
    await q.onIdle();
    expect(calls).toEqual(['schedule:a', 'manual:a']);
  });

  it('429: 해당 레인만 Retry-After 동안 멈추고, 시간이 지나면 같은 작업을 rateLimitedCount+1 로 다시 실행', async () => {
    vi.useFakeTimers();
    const q = new InProcessSyncQueue();
    const seen: [string, number][] = [];
    q.start(async (job, ctx) => {
      seen.push([job.gameAccountId, ctx.rateLimitedCount]);
      return job.gameAccountId === 'r' && ctx.rateLimitedCount === 0 ? { retryAfterSec: 30 } : undefined;
    });
    await q.enqueue(j('riot-tier', 'r', 3));
    await q.enqueue(j('riot-tier', 'r2', 3));
    await q.enqueue(j('steam-playtime', 's', 5));
    await vi.advanceTimersByTimeAsync(0);
    // riot 레인은 멈춤, steam 은 진행
    expect(seen).toEqual([['r', 0], ['s', 0]]);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(seen).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(seen.slice(2).map((x) => x[0])).toEqual(['r', 'r2']);
    expect(seen[2]).toEqual(['r', 1]);
  });

  it('핸들러 예외가 나도 다음 작업을 계속 처리', async () => {
    const q = new InProcessSyncQueue();
    const done: string[] = [];
    q.start(async (job) => {
      if (job.gameAccountId === 'x') throw new Error('boom');
      done.push(job.gameAccountId);
      return undefined;
    });
    await q.enqueue(j('riot-tier', 'x', 3));
    await q.enqueue(j('riot-tier', 'y', 4));
    await q.onIdle();
    expect(done).toEqual(['y']);
  });

  it('dedupeKey / jobPriority', () => {
    expect(dedupeKey(j('riot-full', 'a', 1, 'manual'))).toBe('manual-a');
    expect(dedupeKey(j('riot-tier', 'a', 3))).toBe('riot-tier-a');
    expect(jobPriority('riot-full', 'link')).toBe(1);
    expect(jobPriority('riot-matches', 'profile-view')).toBe(2);
    expect(jobPriority('riot-tier', 'schedule', true)).toBe(3);
    expect(jobPriority('riot-tier', 'schedule', false)).toBe(4);
    expect(jobPriority('steam-playtime', 'schedule')).toBe(5);
  });
});

describe('SyncScheduler 생산자', () => {
  it('SQL 순서대로 우선순위를 붙여 등록한다(활동 3 / 그 외 4 / 스팀 5)', async () => {
    const store = new MemorySyncStore();
    store.tierTargets = [
      { id: 'p1', kind: 'riot-tier', activeMember: true },
      { id: 'p2', kind: 'riot-tier', activeMember: false },
    ];
    store.steamTargets = [{ id: 's1', kind: 'steam-playtime', activeMember: false }];
    const enqueued: SyncJob[] = [];
    const sch = new SyncScheduler(store, { enqueue: async (x) => void enqueued.push(x) });
    expect(await sch.produceTier()).toBe(2);
    expect(await sch.produceSteam()).toBe(1);
    expect(enqueued.map((e) => [e.kind, e.gameAccountId, e.priority, e.reason])).toEqual([
      ['riot-tier', 'p1', 3, 'schedule'],
      ['riot-tier', 'p2', 4, 'schedule'],
      ['steam-playtime', 's1', 5, 'schedule'],
    ]);
  });

  it('멈춘 행(10분 초과)만 queued 로 되돌려 recovery 작업으로 다시 등록', async () => {
    const store = new MemorySyncStore();
    const now = new Date('2026-10-28T03:00:00Z');
    const stuck = store.addRiot('u1', 'FAKE-A');
    const fresh = store.addRiot('u2', 'FAKE-B');
    const steam = store.addSteam('u3', '76561190000000003');
    for (const r of [stuck.lol, stuck.tft!, steam]) {
      store.row(r.id).syncState = 'running';
      store.row(r.id).syncStateAt = new Date(now.getTime() - 11 * 60_000);
    }
    for (const r of [fresh.lol, fresh.tft!]) {
      store.row(r.id).syncState = 'running';
      store.row(r.id).syncStateAt = new Date(now.getTime() - 60_000);
    }
    const enqueued: SyncJob[] = [];
    const sch = new SyncScheduler(store, { enqueue: async (x) => void enqueued.push(x) }, undefined, () => now);
    expect(await sch.recoverStuck()).toBe(2);
    expect(enqueued.map((e) => [e.kind, e.gameAccountId, e.reason])).toEqual([
      ['riot-full', stuck.lol.id, 'recovery'],
      ['steam-playtime', steam.id, 'recovery'],
    ]);
    for (const r of [stuck.lol, stuck.tft!, steam]) {
      expect(store.row(r.id).syncState).toBe('queued');
      expect(store.row(r.id).syncStateAt).toEqual(now);
    }
    expect(store.row(fresh.lol.id).syncState).toBe('running');
  });

  it('시작 시 in-process 모드는 queued 행을 다시 등록(상태 변경 없음), Redis 모드는 하지 않는다', async () => {
    const mk = () => {
      const store = new MemorySyncStore();
      const a = store.addRiot('u1', 'FAKE-A'); // queued, 방금 만든 행(syncStateAt=0 이므로 멈춘 행이기도 함)
      return { store, a };
    };
    const opts = (redisUrl?: string) => ({ redisUrl }) as never;
    const m1 = mk();
    const e1: SyncJob[] = [];
    await new SyncScheduler(m1.store, { enqueue: async (x) => void e1.push(x) }, opts(), () => new Date(0)).onApplicationBootstrap();
    expect(e1.map((e) => e.gameAccountId)).toEqual([m1.a.lol.id]);
    const m2 = mk();
    const e2: SyncJob[] = [];
    await new SyncScheduler(m2.store, { enqueue: async (x) => void e2.push(x) }, opts('redis://x'), () => new Date(0)).onApplicationBootstrap();
    expect(e2).toEqual([]);
  });

  it('advisory lock 을 못 얻으면 등록하지 않는다', async () => {
    const store = new MemorySyncStore();
    store.lockHeld = true;
    store.tierTargets = [{ id: 'p1', kind: 'riot-tier', activeMember: true }];
    const enqueue = vi.fn();
    const sch = new SyncScheduler(store, { enqueue });
    expect(await sch.produceTier()).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
