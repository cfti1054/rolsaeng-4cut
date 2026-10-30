import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type EloUpdate,
  type RatedPlayer,
  computePlacementEloUpdates,
  computeTeamEloUpdates,
  selectRatedParticipants,
  validatePlacementUsers,
} from '@gcd/core';
import {
  type ApproveScrimResultRequest,
  type RejectScrimResultRequest,
  SCRIM_RESULT_STATUS_TRANSITIONS,
  type ScrimDetail,
  type ScrimResultPlacementsJson,
  type SubmitScrimResultRequest,
  canTransition,
} from '@gcd/shared';
import { Prisma } from '@prisma/client';
import { AppError } from '../../common/app-error';
import { SCRIM_TX_TIMEOUT_MS, scrimWriteTx } from '../../common/scrim-tx';
import { APP_CLOCK, type Clock } from '../../common/clock';
import type { AuthUser } from '../../common/decorators/current-user';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { countRatedGames } from '../ratings/rating-inputs.service';
import { lockUserRatings } from '../ratings/rating-locks';
import { loadTierSeeds } from '../ratings/rating-seed';
import { SeasonsService } from '../ratings/seasons.service';
import { readPlacements } from './scrim-result-json';
import { hasActiveResult } from './scrim-teams.service';
import { ScrimViews } from './scrim-views.service';
import { assertScrimTransition, loadGame, lockOrNotFound } from './scrims.service';

type Tx = Prisma.TransactionClient;

const logger = new Logger('ScrimResultsService');

function isP2002(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function assertResultTransition(from: 'pending', to: 'approved' | 'rejected'): void {
  if (!canTransition(SCRIM_RESULT_STATUS_TRANSITIONS, from, to)) {
    logger.error(`허용되지 않은 결과 상태 전이 ${from} → ${to}`);
    throw new AppError('INTERNAL_ERROR');
  }
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
   * now 확정 → 시즌 판정·자동 생성 → ratings 시드·갱신 + rating_history → 결과 조건부 update → playing → finished.
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
        const placements = game.hasTeams ? null : readPlacements(pending.placements);
        if (!game.hasTeams && placements === null) {
          // 저장 JSON이 깨졌으면 skipped로 확정하지 않는다(되돌리기 없음, D123) → 롤백, 결과 pending 유지(QA minor 3)
          logger.error(`승인 중단: 개인 순위 결과 placements 형식 오류 result=${pending.id}`);
          throw new AppError('INTERNAL_ERROR');
        }
        const selection = selectRatedParticipants({
          hasTeams: game.hasTeams,
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

          // 9. ratings 행 확보(없으면 시드로 INSERT … ON CONFLICT DO NOTHING) + 경기 수(반영 전)
          const existing = await tx.rating.findMany({ where: { userId: { in: locked }, gameId: game.id, seasonId: season.id } });
          const missing = locked.filter((u) => !existing.some((r) => r.userId === u));
          if (missing.length > 0) {
            const seeds = await loadTierSeeds(tx, game, missing);
            await tx.rating.createMany({
              data: missing.map((userId) => ({
                userId,
                gameId: game.id,
                seasonId: season.id,
                elo: seeds.get(userId) as number,
              })),
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

  /** POST /scrims/:id/result/reject — 운영진. 내전은 playing 유지 */
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
}
