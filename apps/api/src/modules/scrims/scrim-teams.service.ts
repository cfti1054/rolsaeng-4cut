import { Inject, Injectable } from '@nestjs/common';
import { type BalanceResult, balanceDuos, balanceTeams, previewTeamElo, roundHalfAwayFromZero, validateTeamAssignment } from '@gcd/core';
import {
  BALANCE_ELO_WEIGHT_MAX,
  BALANCE_FULL_WEIGHT_GAMES,
  BALANCE_PLAYERS_MAX,
  BALANCE_PLAYERS_MIN,
  type BalanceOptionMember,
  BalanceScrimResponse,
  type SaveScrimTeamsRequest,
  type ScrimDetail,
  type ScrimStatus,
} from '@gcd/shared';
import type { Game, Prisma } from '@prisma/client';
import { AppError } from '../../common/app-error';
import { scrimWriteTx } from '../../common/scrim-tx';
import { APP_CLOCK, type Clock } from '../../common/clock';
import type { AuthUser } from '../../common/decorators/current-user';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { RatingInputsService } from '../ratings/rating-inputs.service';
import { ScrimViews, orderSlots, roundProbability, teamSideView, teamsUsePositions } from './scrim-views.service';
import { loadGame, lockOrNotFound } from './scrims.service';

type Db = Pick<Prisma.TransactionClient, 'scrimResult'>;

/** 활성 결과(pending·approved) 있음 */
export async function hasActiveResult(db: Db, scrimId: string): Promise<boolean> {
  const n = await db.scrimResult.count({ where: { scrimId, status: { in: ['pending', 'approved'] } } });
  return n > 0;
}

/** 팀 구성 가능 상태(5-2 2번, 5-3 1번): has_teams && status ∈ {full, playing} && 활성 결과 없음 */
function assertTeamsEditable(game: Pick<Game, 'hasTeams'>, status: ScrimStatus, active: boolean): void {
  if (!game.hasTeams || (status !== 'full' && status !== 'playing') || active) {
    throw new AppError('SCRIM_TEAMS_NOT_EDITABLE');
  }
}

function assertHostOrAdmin(user: AuthUser, hostId: string): void {
  if (hostId !== user.id && user.role !== 'admin') throw new AppError('FORBIDDEN');
}

/**
 * 팀 자동 밸런스(5-2)·팀 구성 저장(5-3). 계산은 core balanceTeams·validateTeamAssignment만 쓴다.
 */
@Injectable()
export class ScrimTeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly views: ScrimViews,
    private readonly ratingInputs: RatingInputsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  /** POST /scrims/:id/balance — 잠금·쓰기 없음(계산만) */
  async balance(user: AuthUser, id: string): Promise<BalanceScrimResponse> {
    const now = this.clock.now();
    const scrim = await this.prisma.scrim.findUnique({ where: { id } });
    if (!scrim) throw new AppError('NOT_FOUND');
    assertHostOrAdmin(user, scrim.hostId);
    const game = await loadGame(this.prisma, scrim.gameId);
    assertTeamsEditable(game, scrim.status, await hasActiveResult(this.prisma, scrim.id));
    if (!scrim.autoBalance) throw new AppError('SCRIM_BALANCE_UNAVAILABLE');

    const rows = await this.prisma.scrimPlayer.findMany({ where: { scrimId: scrim.id, status: 'joined' } });
    const eligible = orderSlots(rows, scrim.hostId);
    const n = eligible.length;
    if (n < BALANCE_PLAYERS_MIN || n > BALANCE_PLAYERS_MAX) throw new AppError('SCRIM_BALANCE_UNAVAILABLE');

    const inputs = await this.ratingInputs.forUsers(game, eligible.map((p) => p.userId), now);
    const players = eligible.map((p) => {
      const s = inputs.get(p.userId);
      if (!s) throw new AppError('INTERNAL_ERROR', undefined, { message: '실력값 입력 없음' });
      return { userId: p.userId, skill: s.skill, rating: s.rating, preferredPositions: p.preferredPositions };
    });
    const usePositions = teamsUsePositions(scrim, game);
    let result: { options: BalanceResult[]; partitionsEvaluated: number };
    try {
      result = balanceTeams({ players, usePositions, positions: game.positions });
    } catch (err) {
      // 한 팀 인원 > 포지션 수(5-2 5번)
      if (err instanceof RangeError) throw new AppError('SCRIM_BALANCE_UNAVAILABLE', undefined, { cause: err });
      throw err;
    }

    const users = await this.views.usersById(eligible.map((p) => p.userId));
    const member = (m: { userId: string; position: string | null; preference: BalanceOptionMember['preference'] }) => {
      const s = inputs.get(m.userId);
      if (!s) throw new AppError('INTERNAL_ERROR', undefined, { message: '실력값 입력 없음' });
      return {
        user: this.views.userRef(users, m.userId),
        position: m.position,
        preference: m.preference,
        skill: s.skill,
        rating: s.rating,
        is_new: s.isNew,
      };
    };
    const k = this.config.rating;
    return BalanceScrimResponse.parse({
      options: result.options.map((o, i) => {
        const preview = scrim.rated
          ? previewTeamElo({ blueAvg: o.blue.ratingAvg, orangeAvg: o.orange.ratingAvg, k: k.kBase, lossRatio: k.lossRatio })
          : null;
        return {
          rank: i + 1,
          blue: { ...teamSideView(o.blue, preview?.blue ?? null), members: o.blue.members.map(member) },
          orange: { ...teamSideView(o.orange, preview?.orange ?? null), members: o.orange.members.map(member) },
          blue_win_probability: roundProbability(o.blueWinProbability),
          power_diff: roundHalfAwayFromZero(o.powerDiff),
          position_cost: roundHalfAwayFromZero(o.positionCost),
          total_cost: roundHalfAwayFromZero(o.totalCost),
        };
      }),
      player_count: n,
      partitions_evaluated: result.partitionsEvaluated,
      used_positions: usePositions,
      rating_policy: {
        k_base: k.kBase,
        k_new: k.kNew,
        new_player_games: k.newPlayerGames,
        loss_ratio: k.lossRatio,
        full_weight_games: BALANCE_FULL_WEIGHT_GAMES,
        elo_weight_max: BALANCE_ELO_WEIGHT_MAX,
      },
    });
  }

  /** PUT /scrims/:id/teams — 전체 덮어쓰기(D109). 트랜잭션 + 내전 행 잠금 */
  async saveTeams(user: AuthUser, id: string, body: SaveScrimTeamsRequest): Promise<ScrimDetail> {
    const now = this.clock.now();
    await scrimWriteTx(this.prisma, async (tx) => {
      const s = await lockOrNotFound(tx, id);
      assertHostOrAdmin(user, s.hostId);
      const game = await loadGame(tx, s.gameId);
      assertTeamsEditable(game, s.status, await hasActiveResult(tx, s.id));

      const joined = await tx.scrimPlayer.findMany({ where: { scrimId: s.id, status: 'joined' }, select: { userId: true } });
      const usePositions = teamsUsePositions(s, game);
      const toSlots = (team: SaveScrimTeamsRequest['blue']) => team.map((x) => ({ userId: x.user_id, position: x.position }));
      const issues = validateTeamAssignment({
        eligibleUserIds: joined.map((p) => p.userId),
        blue: toSlots(body.blue),
        orange: toSlots(body.orange),
        usePositions,
        positions: game.positions,
      });
      if (issues.length > 0) throw new AppError('VALIDATION_FAILED', undefined, { details: issues });

      // 3. joined·no_show 전원 초기화 → 요청 슬롯대로(상태 전이 없음)
      await tx.scrimPlayer.updateMany({
        where: { scrimId: s.id, status: { in: ['joined', 'no_show'] } },
        data: { team: null, position: null, duoIndex: null },
      });
      for (const team of ['blue', 'orange'] as const) {
        const slots = body[team];
        if (usePositions) {
          for (const slot of slots) {
            await tx.scrimPlayer.updateMany({
              where: { scrimId: s.id, userId: slot.user_id, status: 'joined' },
              data: { team, position: slot.position },
            });
          }
        } else {
          await tx.scrimPlayer.updateMany({
            where: { scrimId: s.id, userId: { in: slots.map((x) => x.user_id) }, status: 'joined' },
            data: { team, position: null },
          });
        }
      }
    });
    return this.views.detail(id, user, now);
  }

  /** POST /scrims/:id/duos — 롤체 더블업 2인 팀을 계산해 저장하고 상세를 돌려준다. */
  async assignDuos(user: AuthUser, id: string): Promise<ScrimDetail> {
    const now = this.clock.now();
    await scrimWriteTx(this.prisma, async (tx) => {
      const s = await lockOrNotFound(tx, id);
      assertHostOrAdmin(user, s.hostId);
      if (s.tftMode !== 'double_up' || !s.autoBalance) throw new AppError('SCRIM_BALANCE_UNAVAILABLE');
      if ((s.status !== 'full' && s.status !== 'playing') || (await hasActiveResult(tx, s.id))) {
        throw new AppError('SCRIM_TEAMS_NOT_EDITABLE');
      }
      const game = await loadGame(tx, s.gameId);
      const rows = await tx.scrimPlayer.findMany({ where: { scrimId: s.id, status: 'joined' } });
      const eligible = orderSlots(rows, s.hostId);
      if (eligible.length < 2 || eligible.length > 8 || eligible.length % 2 !== 0) {
        throw new AppError('SCRIM_BALANCE_UNAVAILABLE');
      }
      const inputs = await this.ratingInputs.forUsers(game, eligible.map((p) => p.userId), now);
      const players = eligible.map((p) => {
        const skill = inputs.get(p.userId);
        if (!skill) throw new AppError('INTERNAL_ERROR', undefined, { message: '실력값 입력 없음' });
        return { userId: p.userId, skill: skill.skill };
      });
      const pairs = balanceDuos(players);
      await tx.scrimPlayer.updateMany({
        where: { scrimId: s.id },
        data: { duoIndex: null, team: null, position: null },
      });
      for (const pair of pairs) {
        await tx.scrimPlayer.updateMany({
          where: { scrimId: s.id, userId: { in: [...pair.userIds] }, status: 'joined' },
          data: { duoIndex: pair.index },
        });
      }
    });
    return this.views.detail(id, user, now);
  }
}
