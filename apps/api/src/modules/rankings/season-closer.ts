import { Inject, Injectable, Logger } from '@nestjs/common';
import { computeSeasonBadges, computeSeasonStandings, selectSeasonsToClose } from '@gcd/core';
import { GameCode, SEASON_CLOSE_GRACE_SEC, seasonBadgeCode, seasonBadgeSeed } from '@gcd/shared';
import { Prisma } from '@prisma/client';
import { APP_CLOCK, type Clock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { rankableUserWhere } from './rankable-users';

type Tx = Prisma.TransactionClient;

/** pg_try_advisory_xact_lock(hashtext(키)) — 여러 인스턴스 중 하나만 실행(D144) */
export const SEASON_CLOSE_LOCK_KEY = 'season-close';
const RUN_TX_TIMEOUT_MS = 5 * 60_000;
const CLOSE_TX_TIMEOUT_MS = 60_000;
const TX_MAX_WAIT_MS = 10_000;

export type SeasonCloseOutcome = 'closed' | 'skipped';
export type SeasonCloseRun = { acquired: boolean; closed: number; skipped: number; failed: number };

/**
 * 시즌 종료 처리(계약 S4 6-3, D141·D144·D145). 최종 순위와 뱃지를 시즌당 한 트랜잭션으로 기록하고 closed_at을 찍는다.
 * 소프트 리셋은 여기서 하지 않는다. ratings를 쓰지 않고 다음 시즌도 만들지 않는다(D140, D143).
 * 잠금: season-close(try) → 시즌 행 FOR NO KEY UPDATE. 내전·사용자 잠금을 잡지 않아 승인과 교착이 없다(6-3).
 * 이 서비스는 항상 등록되고, cron은 RankingJobsScheduler(RANKING_JOBS_ENABLED)가 건다.
 */
@Injectable()
export class SeasonCloser {
  private readonly log = new Logger('SeasonCloser');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  async runOnce(): Promise<SeasonCloseRun> {
    const out: SeasonCloseRun = { acquired: false, closed: 0, skipped: 0, failed: 0 };
    await this.prisma.$transaction(
      async (tx) => {
        const lock = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${SEASON_CLOSE_LOCK_KEY})) AS ok`;
        if (!lock[0]?.ok) return;
        out.acquired = true;
        const seasons = await tx.season.findMany();
        const now = this.clock.now();
        for (const s of selectSeasonsToClose(seasons, now, SEASON_CLOSE_GRACE_SEC * 1000)) {
          try {
            if ((await this.closeOne(s.id, now)) === 'closed') out.closed++;
            else out.skipped++;
          } catch (err) {
            // 시즌끼리 의존이 없다(D140). 다음 주기에 재시도
            out.failed++;
            this.log.error(`시즌 종료 처리 실패 season=${s.id}: ${err instanceof Error ? err.message : 'unknown'}`);
          }
        }
      },
      { timeout: RUN_TX_TIMEOUT_MS, maxWait: TX_MAX_WAIT_MS },
    );
    return out;
  }

  /** 한 시즌, 전부 또는 전무. 시즌 행을 잠근 뒤 다시 판정하고 ratings는 잠금 뒤에 읽는다(진행 중 승인의 커밋을 본다) */
  async closeOne(seasonId: string, now: Date): Promise<SeasonCloseOutcome> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ ends_at: Date; closed_at: Date | null }[]>`
          SELECT id::text AS id, ends_at, closed_at FROM seasons WHERE id = ${seasonId}::uuid FOR NO KEY UPDATE`;
        const season = rows[0];
        if (!season || season.closed_at !== null) return 'skipped';
        if (season.ends_at.getTime() + SEASON_CLOSE_GRACE_SEC * 1000 > now.getTime()) return 'skipped';

        const ratings = await tx.rating.findMany({ where: { seasonId, user: rankableUserWhere } });
        const games = await tx.game.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
        for (const game of games) {
          const code = GameCode.safeParse(game.code);
          if (!code.success) {
            this.log.warn(`시즌 종료: GameCode가 아닌 games 행 건너뜀 ${game.code}`);
            continue;
          }
          const standings = computeSeasonStandings({
            rows: ratings.filter((r) => r.gameId === game.id),
            minGames: this.config.ranking.eloMinGames,
          });
          if (standings.length === 0) continue;
          await tx.seasonStanding.createMany({
            data: standings.map((s) => ({ seasonId, gameId: game.id, ...s })),
            skipDuplicates: true,
          });
          await this.grantBadges(tx, { id: game.id, code: code.data, name: game.name }, seasonId, season.ends_at, standings);
        }

        const updated = await tx.season.updateMany({ where: { id: seasonId, closedAt: null }, data: { closedAt: now } });
        if (updated.count !== 1) throw new Error(`시즌 closed_at 갱신 행 수 ${updated.count}`);
        return 'closed';
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: CLOSE_TX_TIMEOUT_MS,
        maxWait: TX_MAX_WAIT_MS,
      },
    );
  }

  /** 뱃지 행 보장(시드를 안 돌린 환경 방어) 후 지급. earned_at = ends_at(재실행·지연과 무관한 고정값) */
  private async grantBadges(
    tx: Tx,
    game: { id: string; code: GameCode; name: string },
    seasonId: string,
    endsAt: Date,
    standings: readonly { userId: string; rank: number }[],
  ): Promise<void> {
    await tx.badge.createMany({ data: seasonBadgeSeed(game), skipDuplicates: true });
    const badges = await tx.badge.findMany({ where: { code: { in: seasonBadgeSeed(game).map((b) => b.code) } } });
    const idByCode = new Map(badges.map((b) => [b.code, b.id]));
    await tx.userBadge.createMany({
      data: computeSeasonBadges(standings).map((b) => {
        const code = seasonBadgeCode(game.code, b.place);
        const badgeId = idByCode.get(code);
        if (!badgeId) throw new Error(`뱃지 행 없음: ${code}`);
        return { userId: b.userId, badgeId, seasonId, earnedAt: endsAt };
      }),
      skipDuplicates: true,
    });
  }
}
