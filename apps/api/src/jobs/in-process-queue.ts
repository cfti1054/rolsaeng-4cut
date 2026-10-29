import { Logger } from '@nestjs/common';
import type { SyncJob, SyncQueue } from '../integrations/contracts';
import type { JobResult, JobRunContext } from './sync-worker';

export type SyncJobHandler = (job: SyncJob, ctx: JobRunContext) => Promise<JobResult>;
export type Lane = 'riot' | 'steam';

export function laneOf(job: SyncJob): Lane {
  return job.kind === 'steam-playtime' ? 'steam' : 'riot';
}

/** 중복 제거 키(계약 6-3). manual/link 는 주기 작업과 별도 키 */
export function dedupeKey(job: SyncJob): string {
  const prefix = job.reason === 'manual' || job.reason === 'link' ? 'manual' : job.kind;
  return `${prefix}-${job.gameAccountId}`;
}

/** 작업 종류·사유·활동 여부별 우선순위(작을수록 먼저, 계약 6-2 표) */
export function jobPriority(kind: SyncJob['kind'], reason: SyncJob['reason'], activeMember = false): number {
  if (reason === 'manual' || reason === 'link') return 1;
  switch (kind) {
    case 'riot-full':
      return 1;
    case 'riot-matches':
      return 2;
    case 'riot-tier':
      return activeMember ? 3 : 4;
    case 'steam-playtime':
      return 5;
  }
}

export interface SyncQueueRunner extends SyncQueue {
  start(handler: SyncJobHandler): void;
  stop(): Promise<void>;
}

type Entry = { job: SyncJob; seq: number; rateLimitedCount: number };

/**
 * Redis 없이 쓰는 메모리 큐(계약 6-3). 제공자(riot/steam)별 동시 실행 1, 우선순위 → 등록 순,
 * 같은 키는 대기·실행 중 모두 무시. 429면 해당 레인만 Retry-After 동안 멈추고 작업을 다시 넣는다.
 * 재시작으로 잃은 작업은 DB sync_state를 보는 정리 작업이 다시 등록한다.
 */
export class InProcessSyncQueue implements SyncQueueRunner {
  private readonly log = new Logger('InProcessSyncQueue');
  private readonly pending = new Map<string, Entry>();
  private readonly inFlight = new Set<string>();
  private readonly running: Record<Lane, boolean> = { riot: false, steam: false };
  private readonly pausedUntil: Record<Lane, number> = { riot: 0, steam: 0 };
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private handler: SyncJobHandler | null = null;
  private seq = 0;
  private idleWaiters: (() => void)[] = [];

  constructor(private readonly nowMs: () => number = () => Date.now()) {}

  async enqueue(job: SyncJob): Promise<void> {
    const key = dedupeKey(job);
    if (this.pending.has(key) || this.inFlight.has(key)) return;
    this.pending.set(key, { job, seq: this.seq++, rateLimitedCount: 0 });
    this.pump();
  }

  start(handler: SyncJobHandler): void {
    this.handler = handler;
    this.pump();
  }

  async stop(): Promise<void> {
    this.handler = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  /** 대기·실행 중 작업이 없을 때까지(테스트용). 레인이 멈춰 있으면 재개 후까지 기다린다 */
  onIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  pendingKeys(): string[] {
    return [...this.pending.keys()];
  }

  private isIdle(): boolean {
    return this.pending.size === 0 && this.inFlight.size === 0;
  }

  private pump(): void {
    if (!this.handler) return;
    for (const lane of ['riot', 'steam'] as const) {
      if (this.running[lane] || this.nowMs() < this.pausedUntil[lane]) continue;
      let best: [string, Entry] | null = null;
      for (const kv of this.pending) {
        if (laneOf(kv[1].job) !== lane) continue;
        if (!best || kv[1].job.priority < best[1].job.priority || (kv[1].job.priority === best[1].job.priority && kv[1].seq < best[1].seq)) {
          best = kv;
        }
      }
      if (best) void this.execute(lane, best[0], best[1]);
    }
    if (this.isIdle()) {
      const w = this.idleWaiters;
      this.idleWaiters = [];
      for (const r of w) r();
    }
  }

  private async execute(lane: Lane, key: string, entry: Entry): Promise<void> {
    this.pending.delete(key);
    this.inFlight.add(key);
    this.running[lane] = true;
    let retry: number | undefined;
    try {
      const res = await this.handler?.(entry.job, { rateLimitedCount: entry.rateLimitedCount });
      retry = res?.retryAfterSec;
    } catch (err) {
      this.log.error(`작업 처리 중 예외 kind=${entry.job.kind} account=${entry.job.gameAccountId}: ${err instanceof Error ? err.message : 'unknown'}`);
    }
    this.inFlight.delete(key);
    this.running[lane] = false;
    if (retry !== undefined) {
      // 429: 레인을 멈추고 다시 넣는다(즉시 재시도 금지)
      this.pausedUntil[lane] = this.nowMs() + retry * 1000;
      this.pending.set(key, { job: entry.job, seq: this.seq++, rateLimitedCount: entry.rateLimitedCount + 1 });
      const t = setTimeout(() => {
        this.timers.delete(t);
        this.pump();
      }, retry * 1000);
      this.timers.add(t);
    }
    this.pump();
  }
}
