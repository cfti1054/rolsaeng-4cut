import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type EloUpdate,
  type RatedPlayer,
  computePlacementEloUpdates,
  computeTeamEloUpdates,
  inferRevertOutcomes,
  planRatingRevert,
  revertBlockReason,
  selectRatedParticipants,
  validatePlacementUsers,
} from '@gcd/core';
import {
  type ApproveScrimResultRequest,
  RATING_START_ELO,
  type RejectScrimResultRequest,
  type RevertScrimResultRequest,
  SCRIM_RESULT_REVERT_WINDOW_DAYS,
  SCRIM_RESULT_STATUS_TRANSITIONS,
  type ScrimDetail,
  type ScrimResultRevertBlock,
  type ScrimResultStatus,
  type ScrimResultPlacementsJson,
  type SubmitScrimResultRequest,
  canTransition,
} from '@gcd/shared';
import { Prisma } from '@prisma/client';
import { AppError } from '../../common/app-error';
import { auditQuote, writeAudit } from '../../common/audit';
import { SCRIM_TX_TIMEOUT_MS, scrimWriteTx } from '../../common/scrim-tx';
import { APP_CLOCK, type Clock } from '../../common/clock';
import type { AuthUser } from '../../common/decorators/current-user';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { countRatedGames } from '../ratings/rating-inputs.service';
import { lockSeasonForRating, lockSeasonForRevert, lockUserRatings } from '../ratings/rating-locks';
import { SeasonsService } from '../ratings/seasons.service';
import { laterGameUsersByResult } from './revert-checks';
import { readPlacements } from './scrim-result-json';
import { hasActiveResult } from './scrim-teams.service';
import { ScrimViews } from './scrim-views.service';
import { assertScrimTransition, loadGame, lockOrNotFound } from './scrims.service';

type Tx = Prisma.TransactionClient;

const logger = new Logger('ScrimResultsService');

function isP2002(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function assertResultTransition(from: ScrimResultStatus, to: ScrimResultStatus): void {
  if (!canTransition(SCRIM_RESULT_STATUS_TRANSITIONS, from, to)) {
    logger.error(`허용되지 않은 결과 상태 전이 ${from} → ${to}`);
    throw new AppError('INTERNAL_ERROR');
  }
}

/** 되돌리기를 막는 이유 → 응답 message(SCRIM_RESULT_REVERT_NOT_ALLOWED, 계약 S6 2절) */
export const REVERT_BLOCK_MESSAGE: Record<Exclude<ScrimResultRevertBlock, 'self_submitted'>, string> = {
  window_passed: `승인 후 ${SCRIM_RESULT_REVERT_WINDOW_DAYS}일이 지나 되돌릴 수 없습니다.`,
  season_closed: '시즌 종료 처리가 끝나 되돌릴 수 없습니다.',
  later_games: '참가자의 다음 경기가 이미 반영돼 되돌릴 수 없습니다.',
  rating_mismatch: '레이팅 기록이 맞지 않아 되돌릴 수 없습니다. 개발자에게 알려 주세요.',
};

function revertNotAllowed(reason: Exclude<ScrimResultRevertBlock, 'self_submitted'>): AppError {
  return new AppError('SCRIM_RESULT_REVERT_NOT_ALLOWED', undefined, { message: REVERT_BLOCK_MESSAGE[reason] });
}

/**
 * 결과 제출·제출 취소(5-4)·승인(5-5)·반려(5-6). 모든 쓰기 경로는 트랜잭션 첫 문장에서 내전 행 잠금(S2 5-0).
 * ELO·반영 대상 선택은 core 함수만 쓴다. 상태 변경 응답은 커밋 후 다시 읽은 ScrimDetail(D87).
 */
@Injectable()
export class ScrimResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly views: ScrimViews,
    private readonly seasons: SeasonsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  /** POST /scrims/:id/result */
  async submit(user: AuthUser, id: string, body: SubmitScrimResultRequest): Promise<ScrimDetail> {
    const now = this.clock.now();
    await scrimWriteTx(this.prisma, async (tx) => {
      const s = await lockOrNotFound(tx, id);
      if (s.hostId !== user.id && user.role !== 'admin') throw new AppError('FORBIDDEN');
      if (s.status !== 'playing') throw new AppError('SCRIM_RESULT_NOT_ALLOWED');
      if (await hasActiveResult(tx, s.id)) throw new AppError('SCRIM_RESULT_EXISTS');
      const game = await loadGame(tx, s.gameId);
      if (!game.hasResults) {
        const path = 'winner_team' in body ? 'winner_team' : 'placements';
        throw new AppError('VALIDATION_FAILED', undefined, {
          details: [{ path, message: '인원 모집은 승패를 입력하지 않습니다.' }],
        });
      }

      // 2. 모양 검사(게임 종류와 맞지 않는 본문)
      if (game.hasTeams && 'placements' in body) {
        throw new AppError('VALIDATION_FAILED', undefined, {
          details: [{ path: 'placements', message: '팀 게임은 승리 팀(winner_team)으로 결과를 입력합니다.' }],
        });
      }
      if (!game.hasTeams && 'winner_team' in body) {
        throw new AppError('VALIDATION_FAILED', undefined, {
          details: [{ path: 'winner_team', message: '개인 순위 게임은 순위(placements)로 결과를 입력합니다.' }],
        });
      }

      const joined = await tx.scrimPlayer.findMany({ where: { scrimId: s.id, status: 'joined' } });
      let winnerTeam: 'blue' | 'orange' | null = null;
      let placements: ScrimResultPlacementsJson | null = null;
      if ('winner_team' in body) {
        // 3. 두 팀 모두 joined 배정자 1명 이상
        const blue = joined.some((p) => p.team === 'blue');
        const orange = joined.some((p) => p.team === 'orange');
        if (!blue || !orange) throw new AppError('SCRIM_TEAMS_REQUIRED');
        winnerTeam = body.winner_team;
      } else {
        const issues = validatePlacementUsers({
          eligibleUserIds: joined.map((p) => p.userId),
          placements: body.placements.map((p) => ({ userId: p.user_id })),
        });
        if (issues.length > 0) throw new AppError('VALIDATION_FAILED', undefined, { details: issues });
        placements = body.placements.map((p) => ({ user_id: p.user_id, placement: p.placement }));
      }

      // 4. insert pending. 부분 고유 인덱스(scrim_results_one_active_per_scrim) 위반 → SCRIM_RESULT_EXISTS
      try {
        await tx.scrimResult.create({
          data: {
            scrimId: s.id,
            status: 'pending',
            winnerTeam,
            ...(placements ? { placements } : {}),
            submittedById: user.id,
            // 제출 시각 = 서버 시계(submitted_at). 승인 시각·시즌 판정과 같은 시계를 쓴다
            createdAt: now,
          },
        });
      } catch (err) {
        if (isP2002(err)) throw new AppError('SCRIM_RESULT_EXISTS', undefined, { cause: err });
        throw err;
      }
    });
    return this.views.detail(id, user, now);
  }

  /** DELETE /scrims/:id/result — pending 행 삭제(D112). 제출자 또는 방장 */
  async withdraw(user: AuthUser, id: string): Promise<ScrimDetail> {
    const now = this.clock.now();
    await scrimWriteTx(this.prisma, async (tx) => {
      const s = await lockOrNotFound(tx, id);
      const pending = await tx.scrimResult.findFirst({ where: { scrimId: s.id, status: 'pending' } });
      if (!pending) throw new AppError('SCRIM_RESULT_NOT_PENDING');
      if (pending.submittedById !== user.id && s.hostId !== user.id) throw new AppError('FORBIDDEN');
      const r = await tx.scrimResult.deleteMany({ where: { id: pending.id, status: 'pending' } });
      if (r.count !== 1) throw new AppError('SCRIM_RESULT_NOT_PENDING');
    });
    return this.views.detail(id, user, now);
  }

  /** 승인·반려 공통 1–2단계: pending 행, result_id 일치, 자기 제출 금지 */
  private async pendingForReview(tx: Tx, scrimId: string, resultId: string, reviewer: AuthUser) {
    const pending = await tx.scrimResult.findFirst({ where: { scrimId, status: 'pending' } });
    if (!pending || pending.id !== resultId) throw new AppError('SCRIM_RESULT_NOT_PENDING');
    if (pending.submittedById === reviewer.id) throw new AppError('SCRIM_RESULT_SELF_REVIEW');
    return pending;
  }

  /**
   * POST /scrims/:id/result/approve — 운영진(@Roles는 컨트롤러). 한 트랜잭션(READ COMMITTED):
   * 내전 행 잠금 → (rated && 대상 있음) 시즌 생성 advisory(필요할 수 있을 때만) → 사용자 advisory(user_id 오름차순) →
   * now 확정 → 시즌 판정·자동 생성 → 시즌 행 FOR SHARE(closed_at 검사, S4 7c) → ratings 시작값(전원 RATING_START_ELO, S4 20-4)·갱신 +
   * rating_history → 결과 조건부 update → playing → finished.
   *
   * now(리더 결정, QA minor 1): 모든 잠금을 얻은 **직후** 한 번 정한다(approved_at = rating_history.created_at = 시즌 판정).
   * 잠금 대기 전에 정하면 같은 사용자를 먼저 반영한 다른 승인보다 이른 created_at이 찍혀 그래프(created_at 순) 연결이 끊긴다.
   */
  async approve(admin: AuthUser, id: string, body: ApproveScrimResultRequest): Promise<ScrimDetail> {
    const now = await scrimWriteTx(
      this.prisma,
      async (tx) => {
        const s = await lockOrNotFound(tx, id);
        const pending = await this.pendingForReview(tx, s.id, body.result_id, admin);
        if (s.status !== 'playing') {
          logger.error(`승인 대상 내전 상태가 playing이 아님: ${s.id} ${s.status}`);
          throw new AppError('INTERNAL_ERROR');
        }
        const scrim = await tx.scrim.findUnique({ where: { id: s.id } });
        if (!scrim) throw new AppError('NOT_FOUND');
        const game = await loadGame(tx, s.gameId);

        // 5. 반영 대상(승인 시점 status·team, D115)
        const players = await tx.scrimPlayer.findMany({ where: { scrimId: s.id } });
        const teamResult = pending.winnerTeam !== null;
        const placements = teamResult ? null : readPlacements(pending.placements);
        if (!teamResult && placements === null) {
          // 저장 JSON이 깨졌으면 skipped로 확정하지 않는다(되돌리기 없음, D123) → 롤백, 결과 pending 유지(QA minor 3)
          logger.error(`승인 중단: 개인 순위 결과 placements 형식 오류 result=${pending.id}`);
          throw new AppError('INTERNAL_ERROR');
        }
        const selection = selectRatedParticipants({
          hasTeams: teamResult,
          players: players.map((p) => ({ userId: p.userId, status: p.status, team: p.team })),
          placements: placements === null ? null : placements.map((p) => ({ userId: p.user_id, placement: p.placement })),
        });

        // 6–11
        const ratedRun = scrim.rated && selection.kind !== 'skip';
        let now: Date;
        if (ratedRun) {
          // 7a. 시즌 생성 잠금은 사용자 잠금보다 먼저(D117 순서). now는 아직 모르므로 지금 시각 + 트랜잭션 상한 안에 시즌이 없을 수 있으면 잡는다
          const holdsCreateLock = await this.seasons.lockIfMayCreate(tx, this.clock.now(), SCRIM_TX_TIMEOUT_MS);
          const userIds =
            selection.kind === 'teams' ? [...selection.blue, ...selection.orange] : selection.ranked.map((r) => r.userId);
          const locked = await lockUserRatings(tx, game.id, userIds);
          // 4. 모든 잠금 직후 now 확정
          now = this.clock.now();
          // 7b. now 기준 시즌(없으면 생성)
          const season = await this.seasons.resolveForApproval(tx, now, holdsCreateLock);

          // 7c. 종료 작업과의 경합 방어(S4 6-2, D141). 커밋까지 유지. 닫힌 시즌이면 전체 롤백
          await lockSeasonForRating(tx, season.id);

          // 9. ratings 행 확보(없으면 RATING_START_ELO로 INSERT … ON CONFLICT DO NOTHING, S4 20-4·D182) + 경기 수(반영 전)
          const existing = await tx.rating.findMany({ where: { userId: { in: locked }, gameId: game.id, seasonId: season.id } });
          const missing = locked.filter((u) => !existing.some((r) => r.userId === u));
          if (missing.length > 0) {
            await tx.rating.createMany({
              data: missing.map((userId) => ({ userId, gameId: game.id, seasonId: season.id, elo: RATING_START_ELO })),
              skipDuplicates: true,
            });
          }
          const ratings = await tx.rating.findMany({ where: { userId: { in: locked }, gameId: game.id, seasonId: season.id } });
          const ratingByUser = new Map(ratings.map((r) => [r.userId, r]));
          const games = await countRatedGames(tx, game.id, locked);
          const rated = (userId: string): RatedPlayer => {
            const r = ratingByUser.get(userId);
            if (!r) throw new AppError('INTERNAL_ERROR', undefined, { message: 'ratings 행 없음' });
            return { userId, elo: r.elo, gamesPlayed: games.get(userId) ?? 0 };
          };

          // 10. core 계산
          const policy = this.config.rating;
          let updates: EloUpdate[];
          if (selection.kind === 'teams') {
            if (pending.winnerTeam === null) {
              logger.error(`팀 게임 결과에 winner_team 없음: ${pending.id}`);
              throw new AppError('INTERNAL_ERROR');
            }
            updates = computeTeamEloUpdates({
              blue: selection.blue.map(rated),
              orange: selection.orange.map(rated),
              winner: pending.winnerTeam,
              policy,
            });
          } else {
            updates = computePlacementEloUpdates({
              players: selection.ranked.map((r) => ({ ...rated(r.userId), placement: r.placement })),
              policy,
            });
          }

          // 11. 쓰기
          for (const u of updates) {
            const row = ratingByUser.get(u.userId);
            if (!row) throw new AppError('INTERNAL_ERROR', undefined, { message: 'ratings 행 없음' });
            await tx.rating.update({
              where: { id: row.id },
              data: {
                elo: u.eloAfter,
                ...(u.outcome === 'win' ? { wins: { increment: 1 } } : { losses: { increment: 1 } }),
              },
            });
            try {
              await tx.ratingHistory.create({
                data: {
                  userId: u.userId,
                  scrimId: s.id,
                  scrimResultId: pending.id,
                  gameId: game.id,
                  seasonId: season.id,
                  eloBefore: u.eloBefore,
                  eloAfter: u.eloAfter,
                  kFactor: u.kFactor,
                  createdAt: now,
                },
              });
            } catch (err) {
              if (isP2002(err)) {
                logger.error(`rating_history (scrim_id, user_id) 중복: ${s.id} ${u.userId}`);
                throw new AppError('INTERNAL_ERROR', undefined, { cause: err });
              }
              throw err;
            }
          }
        } else {
          // 레이팅 반영 없음(rated=false·skip): 사용자 잠금이 없으므로 내전 잠금 직후가 「모든 잠금 직후」
          now = this.clock.now();
        }

        // 12. 결과 조건부 update(이중 승인 마지막 방어)
        assertResultTransition('pending', 'approved');
        const r = await tx.scrimResult.updateMany({
          where: { id: pending.id, status: 'pending' },
          data: { status: 'approved', approvedById: admin.id, approvedAt: now },
        });
        if (r.count !== 1) throw new AppError('SCRIM_RESULT_NOT_PENDING');

        // 13. playing → finished
        assertScrimTransition(s.status, 'finished');
        await tx.scrim.update({ where: { id: s.id }, data: { status: 'finished' } });
        return now;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    return this.views.detail(id, admin, now);
  }

  /**
   * POST /scrims/:id/result/reject — 운영진. 내전은 playing 유지.
   */
  async reject(admin: AuthUser, id: string, body: RejectScrimResultRequest): Promise<ScrimDetail> {
    const now = this.clock.now();
    await scrimWriteTx(this.prisma, async (tx) => {
      const s = await lockOrNotFound(tx, id);
      const pending = await this.pendingForReview(tx, s.id, body.result_id, admin);
      assertResultTransition('pending', 'rejected');
      const r = await tx.scrimResult.updateMany({
        where: { id: pending.id, status: 'pending' },
        data: { status: 'rejected', rejectedById: admin.id, rejectedAt: now, rejectReason: body.reason },
      });
      if (r.count !== 1) throw new AppError('SCRIM_RESULT_NOT_PENDING');
    });
    return this.views.detail(id, admin, now);
  }

  /**
   * S6 POST /scrims/:id/result/revert — 승인 되돌리기(계약 S6 6-3, D242–D248). 운영진(@Roles는 컨트롤러).
   * scrimWriteTx READ COMMITTED. 잠금 순서는 승인과 같다: 내전 행 FOR UPDATE → 사용자 advisory(user_id 오름차순) → 시즌 FOR SHARE.
   * now는 모든 잠금 직후(이력이 없으면 내전 잠금 직후). 쓰기: ratings 역반영(plan 값 그대로) → 이력 삭제 → 결과 reverted →
   * 내전 finished → playing → 감사 result.revert(지운 이력 스냅샷). 응답은 커밋 후 ScrimDetail.
   */
  async revert(admin: AuthUser, id: string, body: RevertScrimResultRequest): Promise<ScrimDetail> {
    const now = await scrimWriteTx(
      this.prisma,
      async (tx) => {
        // 1–3
        const s = await lockOrNotFound(tx, id);
        const approved = await tx.scrimResult.findFirst({ where: { scrimId: s.id, status: 'approved' } });
        if (!approved || approved.id !== body.result_id) throw new AppError('SCRIM_RESULT_NOT_APPROVED');
        const history = await tx.ratingHistory.findMany({ where: { scrimResultId: approved.id } });

        // 4. 사용자 잠금 → now → 시즌 FOR SHARE
        let now: Date;
        let seasonId: string | null = null;
        let seasonClosed = false;
        if (history.length > 0) {
          await lockUserRatings(tx, s.gameId, history.map((h) => h.userId));
          now = this.clock.now();
          const seasonIds = [...new Set(history.map((h) => h.seasonId))];
          if (seasonIds.length !== 1) {
            logger.error(`되돌리기: 이력 시즌이 여럿 result=${approved.id} seasons=${seasonIds.join(',')}`);
            throw revertNotAllowed('rating_mismatch');
          }
          seasonId = seasonIds[0] as string;
          seasonClosed = (await lockSeasonForRevert(tx, seasonId)).closed;
        } else {
          now = this.clock.now();
        }
        if (!approved.approvedAt) {
          logger.error(`되돌리기: approved 결과에 approved_at 없음 result=${approved.id}`);
          throw new AppError('INTERNAL_ERROR');
        }

        // 5–6
        const later = history.length > 0 ? ((await laterGameUsersByResult(tx, history)).get(approved.id) ?? []) : [];
        const block = revertBlockReason({
          approvedAt: approved.approvedAt,
          now,
          windowDays: SCRIM_RESULT_REVERT_WINDOW_DAYS,
          submittedById: approved.submittedById,
          actorId: admin.id,
          seasonClosed,
          laterGameUserIds: later,
        });
        if (block === 'self_submitted') throw new AppError('SCRIM_RESULT_SELF_REVIEW');
        if (block !== null) throw revertNotAllowed(block);

        // 7–8a. ratings 역반영 + 이력 삭제
        const snapshot: { user_id: string; elo_before: number; elo_after: number; k_factor: number; outcome: string }[] = [];
        if (history.length > 0 && seasonId !== null) {
          const players = await tx.scrimPlayer.findMany({ where: { scrimId: s.id } });
          const placements = readPlacements(approved.placements);
          const outcomes = inferRevertOutcomes({
            ratedUserIds: history.map((h) => h.userId),
            winnerTeam: approved.winnerTeam,
            teamByUser: new Map(players.map((p) => [p.userId, p.team] as const)),
            placements: placements === null ? null : placements.map((p) => ({ userId: p.user_id, placement: p.placement })),
          });
          if (!outcomes) {
            logger.error(`되돌리기: 승패를 다시 구할 수 없음 result=${approved.id}`);
            throw revertNotAllowed('rating_mismatch');
          }
          const ratings = await tx.rating.findMany({
            where: { userId: { in: history.map((h) => h.userId) }, gameId: s.gameId, seasonId },
          });
          const plan = planRatingRevert({
            history: history.map((h) => ({
              id: h.id,
              userId: h.userId,
              eloBefore: h.eloBefore,
              eloAfter: h.eloAfter,
              createdAt: h.createdAt,
            })),
            ratings: ratings.map((r) => ({ userId: r.userId, elo: r.elo, wins: r.wins, losses: r.losses })),
            outcomes,
          });
          if (!plan.ok) {
            logger.error(`되돌리기: 레이팅 불일치 result=${approved.id} users=${plan.userIds.join(',')}`);
            throw revertNotAllowed('rating_mismatch');
          }
          for (const u of plan.updates) {
            const row = ratings.find((r) => r.userId === u.userId);
            if (!row) throw new AppError('INTERNAL_ERROR', undefined, { message: 'ratings 행 없음' });
            await tx.rating.update({ where: { id: row.id }, data: { elo: u.elo, wins: u.wins, losses: u.losses } });
          }
          const del = await tx.ratingHistory.deleteMany({ where: { scrimResultId: approved.id } });
          if (del.count !== history.length) {
            logger.error(`되돌리기: 이력 삭제 수 불일치 result=${approved.id} ${del.count}/${history.length}`);
            throw new AppError('INTERNAL_ERROR');
          }
          for (const h of history) {
            snapshot.push({
              user_id: h.userId,
              elo_before: h.eloBefore,
              elo_after: h.eloAfter,
              k_factor: h.kFactor,
              outcome: outcomes.get(h.userId) ?? 'loss',
            });
          }
        }

        // 8b. 결과 approved → reverted(조건부 1행)
        assertResultTransition('approved', 'reverted');
        const r = await tx.scrimResult.updateMany({
          where: { id: approved.id, status: 'approved' },
          data: { status: 'reverted', revertedById: admin.id, revertedAt: now, revertReason: body.reason },
        });
        if (r.count !== 1) throw new AppError('SCRIM_RESULT_NOT_APPROVED');

        // 8c. 내전 finished → playing(started_at 그대로)
        assertScrimTransition(s.status, 'playing');
        const scrim = await tx.scrim.update({ where: { id: s.id }, data: { status: 'playing' } });

        // 8d. 감사(D281: 이의 제기 기능 없음)
        await writeAudit(tx, {
          actorId: admin.id,
          action: 'result.revert',
          targetId: approved.id,
          summary: `내전 ${auditQuote(scrim.title)} 결과 승인 되돌리기`,
          details: { scrim_id: s.id, reason: body.reason, season_id: seasonId, history: snapshot },
          at: now,
        });
        return now;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    return this.views.detail(id, admin, now);
  }
}
