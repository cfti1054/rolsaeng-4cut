import { isSameRank, toRankValue } from '@gcd/core';
import {
  LolMatchSummary,
  RANKED_QUEUE_BY_GAME,
  RECENT_MATCHES_MAX,
  RIOT_SOLO_QUEUE_ID,
  type GameAccountSyncError,
  formatRiotId,
  toLolPosition,
} from '@gcd/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DATA_DRAGON,
  type DataDragon,
  ExternalApiError,
  RIOT_API,
  type RiotApi,
  STEAM_API,
  type SteamApi,
  type SyncJob,
} from '../integrations/contracts';
import { SYNC_STORE, type RowRelease, type SyncAccountRow, type SyncStore } from './sync-store';

/** 같은 작업이 429로 이만큼 실패하면 PROVIDER_RATE_LIMITED를 기록한다(계약 6-4) */
export const MAX_RATE_LIMITED = 3;

export type JobRunContext = { rateLimitedCount: number };
/** retryAfterSec가 있으면 큐가 그 시간만큼 레인을 멈추고 작업을 다시 넣는다 */
export type JobResult = { retryAfterSec: number } | undefined;

export const CLOCK_NOW = Symbol('CLOCK_NOW');

function toSyncError(err: unknown): GameAccountSyncError {
  if (err instanceof ExternalApiError) {
    switch (err.kind) {
      case 'not_found':
        return 'ACCOUNT_NOT_FOUND';
      case 'auth':
        return 'PROVIDER_AUTH_FAILED';
      case 'rate_limited':
        return 'PROVIDER_RATE_LIMITED';
      case 'unavailable':
        return 'PROVIDER_UNAVAILABLE';
      case 'not_configured':
        return 'PROVIDER_NOT_CONFIGURED';
      case 'bad_response':
        return 'INTERNAL_ERROR';
    }
  }
  return 'INTERNAL_ERROR';
}

/** 이 종류의 오류가 나면 뒤의 단계도 같은 이유로 실패하므로 중단한다 */
function isFatal(err: unknown): boolean {
  return (
    err instanceof ExternalApiError &&
    (err.kind === 'rate_limited' || err.kind === 'auth' || err.kind === 'not_configured' || err.kind === 'not_found')
  );
}

type Progress = {
  lolTierOk: boolean;
  tftTierOk: boolean;
  matchesOk: boolean;
  steamOk: boolean;
  steamPrivate: boolean;
};

/**
 * 동기화 작업자(계약 6-1, 6-2). 결과를 DB에 저장하고 `queued|idle → running → idle`을 책임진다.
 * 실패해도 기존 데이터는 지우지 않는다. 성공한 부분만 시각을 갱신하고, 어느 부분이든 실패하면 오류 코드를 남긴다.
 */
@Injectable()
export class SyncWorker {
  private readonly log = new Logger('SyncWorker');

  constructor(
    @Inject(SYNC_STORE) private readonly store: SyncStore,
    @Inject(RIOT_API) private readonly riot: RiotApi,
    @Inject(STEAM_API) private readonly steam: SteamApi,
    @Inject(DATA_DRAGON) private readonly ddragon: DataDragon,
    @Inject(CLOCK_NOW) private readonly now: () => Date = () => new Date(),
  ) {}

  async run(job: SyncJob, ctx: JobRunContext = { rateLimitedCount: 0 }): Promise<JobResult> {
    const target = await this.store.loadTarget(job.gameAccountId);
    if (!target) return undefined; // 해제된 계정: 아무것도 하지 않고 끝낸다

    const rows =
      target.provider === 'riot'
        ? ([target.lol, target.tft].filter(Boolean) as SyncAccountRow[])
        : [target.steam];
    const ids = rows.map((r) => r.id);
    const startedAt = this.now();
    if (!(await this.store.claim(ids, startedAt))) return undefined; // 다른 작업자가 실행 중

    const progress: Progress = { lolTierOk: false, tftTierOk: false, matchesOk: false, steamOk: false, steamPrivate: false };
    let firstError: unknown = null;
    try {
      const steps = this.plan(job, target, progress);
      for (const step of steps) {
        try {
          await step.run();
        } catch (err) {
          if (step.optional && !(err instanceof ExternalApiError && err.kind === 'rate_limited')) {
            this.log.warn(`선택 단계 실패(무시): ${err instanceof Error ? err.message : 'unknown'}`);
            continue;
          }
          if (firstError === null) firstError = err;
          if (isFatal(err)) break;
        }
      }
    } catch (err) {
      firstError = err;
    }

    const finishedAt = this.now();
    const rateLimited =
      firstError instanceof ExternalApiError && firstError.kind === 'rate_limited' ? firstError : null;
    if (rateLimited && ctx.rateLimitedCount + 1 < MAX_RATE_LIMITED) {
      // 즉시 재시도 금지: 큐가 Retry-After 동안 레인을 멈추고 다시 넣는다
      await this.store.requeue(ids, finishedAt);
      return { retryAfterSec: rateLimited.retryAfterSec ?? 60 };
    }

    let error: GameAccountSyncError | null = null;
    if (firstError !== null) {
      error = toSyncError(firstError);
      if (!(firstError instanceof ExternalApiError)) {
        const msg = firstError instanceof Error ? firstError.message : 'unknown';
        this.log.error(`동기화 예외 account=${job.gameAccountId} kind=${job.kind}: ${msg}`);
      }
    } else if (progress.steamPrivate) {
      error = 'STEAM_PROFILE_PRIVATE';
    }
    // 실행 중 계정이 해제됐으면 release는 0행을 갱신할 뿐이다
    await this.store.release(this.releases(target, progress, finishedAt), error, finishedAt);
    return undefined;
  }

  private releases(target: Awaited<ReturnType<SyncStore['loadTarget']>>, p: Progress, at: Date): RowRelease[] {
    if (!target) return [];
    if (target.provider === 'steam') {
      return [{ id: target.steam.id, ...(p.steamOk ? { lastSyncedAt: at } : {}) }];
    }
    const out: RowRelease[] = [];
    if (target.lol) {
      out.push({
        id: target.lol.id,
        ...(p.lolTierOk ? { lastSyncedAt: at } : {}),
        ...(p.matchesOk ? { matchesSyncedAt: at } : {}),
      });
    }
    if (target.tft) out.push({ id: target.tft.id, ...(p.tftTierOk ? { lastSyncedAt: at } : {}) });
    return out;
  }

  private plan(
    job: SyncJob,
    target: NonNullable<Awaited<ReturnType<SyncStore['loadTarget']>>>,
    p: Progress,
  ): { optional?: boolean; run: () => Promise<void> }[] {
    if (target.provider === 'steam') return this.steamSteps(job, target.steam, p);

    const { lol, tft } = target;
    const ids = [lol?.id, tft?.id].filter((x): x is string => Boolean(x));
    const puuid = (lol ?? tft)?.externalId;
    if (!puuid) return [];
    const steps: { optional?: boolean; run: () => Promise<void> }[] = [];

    if (job.kind === 'riot-full') {
      steps.push({
        run: async () => {
          const acc = await this.riot.getAccountByPuuid(puuid, 'background');
          await this.store.updateDisplayName(ids, formatRiotId({ game_name: acc.gameName, tag_line: acc.tagLine }));
        },
      });
    }
    if (job.kind === 'riot-full' || job.kind === 'riot-tier') {
      if (lol) {
        steps.push({
          run: async () => {
            await this.syncTier(lol.id, puuid, 'lol');
            p.lolTierOk = true;
          },
        });
      }
      if (tft) {
        steps.push({
          run: async () => {
            await this.syncTier(tft.id, puuid, 'tft');
            p.tftTierOk = true;
          },
        });
      }
    }
    // 최근 전적은 대표 계정의 lol 행만(D40, D57)
    const wantsMatches = job.kind === 'riot-matches' || job.kind === 'riot-full';
    if (wantsMatches && lol?.isPrimary) {
      steps.push({
        run: async () => {
          await this.syncMatches(lol.id, puuid);
          p.matchesOk = true;
        },
      });
    }
    return steps;
  }

  private steamSteps(
    job: SyncJob,
    row: SyncAccountRow,
    p: Progress,
  ): { optional?: boolean; run: () => Promise<void> }[] {
    const steps: { optional?: boolean; run: () => Promise<void> }[] = [];
    if (job.reason !== 'schedule') {
      // 표시 이름 갱신(D52). 실패해도 플레이타임은 계속
      steps.push({
        optional: true,
        run: async () => {
          const s = await this.steam.getPlayerSummary(row.externalId, 'background');
          if (s) await this.store.updateDisplayName([row.id], s.personaName);
        },
      });
    }
    steps.push({
      run: async () => {
        const res = await this.steam.getOwnedGames(row.externalId);
        if (res.visibility === 'private') {
          // 기존 steam_playtime 행은 그대로 둔다(마지막 성공 값 표시)
          p.steamPrivate = true;
          return;
        }
        await this.store.replaceSteamPlaytime(
          row.id,
          res.games.map((g) => ({
            appId: g.appId,
            appName: g.name,
            minutesTotal: g.minutesTotal,
            minutesRecent: g.minutesRecent,
          })),
          this.now(),
        );
        p.steamOk = true;
      },
    });
    return steps;
  }

  /** 티어 저장(D55): 큐별 항목이 없으면 UNRANKED. 같은 값이면 새 스냅샷을 만들지 않는다 */
  private async syncTier(rowId: string, puuid: string, game: 'lol' | 'tft'): Promise<void> {
    const queue = RANKED_QUEUE_BY_GAME[game];
    const entries =
      game === 'lol' ? await this.riot.getLolLeagueEntries(puuid) : await this.riot.getTftLeagueEntries(puuid);
    const rank = toRankValue(entries.find((e) => e.queueType === queue));
    const latest = await this.store.latestSnapshot(rowId, queue);
    if (!latest || !isSameRank(latest, rank)) {
      await this.store.insertSnapshot(rowId, queue, rank, this.now());
    }
  }

  /** 최근 전적(솔로 랭크 420): 없는 매치만 상세 조회 → 요약 저장 → 최신 20개만 유지 */
  private async syncMatches(rowId: string, puuid: string): Promise<void> {
    const ids = await this.riot.getLolMatchIds(puuid, { queue: RIOT_SOLO_QUEUE_ID, count: RECENT_MATCHES_MAX });
    const known = await this.store.existingMatchIds(rowId, ids);
    for (const matchId of ids) {
      if (known.has(matchId)) continue;
      let match;
      try {
        match = await this.riot.getLolMatch(matchId);
      } catch (err) {
        if (err instanceof ExternalApiError && err.kind === 'not_found') continue; // 사라진 매치는 건너뜀
        throw err;
      }
      const me = match.participants.find((x) => x.puuid === puuid);
      if (!me || match.queueId !== RIOT_SOLO_QUEUE_ID) continue;
      const champ = await this.ddragon.champion(me.championId);
      const summary = LolMatchSummary.parse({
        queue_id: match.queueId,
        champion_id: me.championId,
        champion_key: champ?.key ?? String(me.championId),
        position: toLolPosition(me.teamPosition),
        kills: me.kills,
        deaths: me.deaths,
        assists: me.assists,
        duration_sec: match.gameDuration,
      });
      await this.store.upsertMatch(rowId, {
        externalMatchId: match.matchId,
        playedAt: new Date(match.gameEndTimestamp ?? match.gameStartTimestamp),
        win: me.win,
        summary,
      });
    }
    await this.store.trimMatches(rowId, RECENT_MATCHES_MAX);
  }
}

