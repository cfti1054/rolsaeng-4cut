import { Inject, Injectable } from '@nestjs/common';
import {
  type TeamPlan,
  canStartScrim,
  computeOpenPositions,
  evaluateTeams,
  isJoinClosed,
  isNoShowMarkWindowOpen,
  isPlacementWin,
  orderWaitlist,
  positionPreferenceOf,
  previewTeamElo,
  roundHalfAwayFromZero,
} from '@gcd/core';
import {
  BALANCE_PLAYERS_MAX,
  BALANCE_PLAYERS_MIN,
  GameCode,
  type MyScrimStatus,
  ScrimDetail,
  type ScrimOutcome,
  type ScrimRatingChange,
  type ScrimResultView,
  ScrimSummary,
  type ScrimTeamSide,
  type ScrimTeamsView,
  type ScrimUserRef,
} from '@gcd/shared';
import type { Game, RatingHistory, Scrim, ScrimPlayer, ScrimResult, Season, User } from '@prisma/client';
import { AppError } from '../../common/app-error';
import type { AuthUser } from '../../common/decorators/current-user';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { RatingInputsService, type SkillInput } from '../ratings/rating-inputs.service';
import { seasonRef } from '../ratings/seasons.service';
import { discordAvatarUrl } from '../users/me.mapper';
import { isActiveResultStatus, readPlacements } from './scrim-result-json';
import { ScrimRestrictionService } from './scrim-restriction.service';

/** 집계·화면에 필요한 참가자 열만 */
export type PlayerRow = Pick<
  ScrimPlayer,
  'id' | 'scrimId' | 'userId' | 'status' | 'preferredPositions' | 'joinedAt' | 'noShowMarkedAt' | 'position' | 'team'
>;

type UserRow = Pick<User, 'id' | 'nickname' | 'discordId' | 'discordAvatar'>;

export const OPEN_STATUSES = ['recruiting', 'full'] as const;

export function isOpenStatus(s: Scrim['status']): boolean {
  return s === 'recruiting' || s === 'full';
}

/**
 * 참가자 슬롯(joined·no_show) 순서: 방장 먼저, 나머지 joined_at 오름차순, 같으면 user id 순.
 * 상세 players와 밸런스 입력 순서(D108 「블루 = 슬롯 첫 참가자가 있는 쪽」)가 같은 규칙을 쓴다.
 */
export function orderSlots<T extends Pick<PlayerRow, 'userId' | 'status' | 'joinedAt'>>(players: readonly T[], hostId: string): T[] {
  return players
    .filter((p) => p.status === 'joined' || p.status === 'no_show')
    .sort((a, b) => {
      const ah = a.userId === hostId ? 0 : 1;
      const bh = b.userId === hostId ? 0 : 1;
      if (ah !== bh) return ah - bh;
      const t = a.joinedAt.getTime() - b.joinedAt.getTime();
      if (t !== 0) return t;
      return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
    });
}

/** 밸런스·팀 요약의 포지션 사용 여부(scrim.use_positions && game.has_positions) */
export function teamsUsePositions(scrim: Pick<Scrim, 'usePositions'>, game: Pick<Game, 'hasPositions'>): boolean {
  return scrim.usePositions && game.hasPositions;
}

/** 블루 기대 승률 표시값(소수 셋째 자리) */
export function roundProbability(p: number): number {
  return Math.round(p * 1000) / 1000;
}

/** core TeamPlan → ScrimTeamSide(표시 반올림은 여기서, 계약 7-4 7번) */
export function teamSideView(plan: TeamPlan, eloPreview: { win: number; lose: number } | null): ScrimTeamSide {
  return {
    size: plan.members.length,
    skill_sum: roundHalfAwayFromZero(plan.skillSum),
    skill_avg: roundHalfAwayFromZero(plan.skillAvg),
    rating_avg: roundHalfAwayFromZero(plan.ratingAvg),
    position_cost: roundHalfAwayFromZero(plan.positionCost),
    elo_preview: eloPreview,
  };
}

type ResultRow = ScrimResult;

/**
 * 결과 행 정렬(최근 것 먼저): created_at DESC → 활성(pending·approved) 먼저 → id DESC.
 * 활성 행은 항상 마지막에 만든 행이다(활성이 없을 때만 새 행 insert, D113). 같은 ms에 반려·재제출이 겹쳐도
 * uuid 순서에 따라 반려 행이 「최근」으로 잡히지 않게 활성 여부를 id보다 먼저 본다.
 */
function latestFirst(a: ResultRow, b: ResultRow): number {
  const t = b.createdAt.getTime() - a.createdAt.getTime();
  if (t !== 0) return t;
  const act = Number(isActiveResultStatus(b.status)) - Number(isActiveResultStatus(a.status));
  if (act !== 0) return act;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * ScrimSummary·ScrimDetail 조립(계약 S2 4-2, S3 4-1). 모두 shared 스키마 parse를 거친다(S1 D38 — 사용자는
 * ScrimUserRef(id·nickname·avatar_url)만, email·discord_id 미포함).
 * select·include 없이 테이블별로 한 번씩 읽는다(N+1 없음): 내전 → 게임 → 참가자(내전 id IN) → 결과(내전 id IN) → 사용자(id IN).
 */
@Injectable()
export class ScrimViews {
  constructor(
    private readonly prisma: PrismaService,
    private readonly restriction: ScrimRestrictionService,
    private readonly ratingInputs: RatingInputsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async gamesById(): Promise<Map<string, Game>> {
    const rows = await this.prisma.game.findMany();
    return new Map(rows.map((g) => [g.id, g]));
  }

  async usersById(ids: Iterable<string>): Promise<Map<string, UserRow>> {
    const list = [...new Set(ids)];
    if (list.length === 0) return new Map();
    const rows = await this.prisma.user.findMany({
      where: { id: { in: list } },
      select: { id: true, nickname: true, discordId: true, discordAvatar: true },
    });
    return new Map(rows.map((u) => [u.id, u]));
  }

  userRef(users: Map<string, UserRow>, id: string): ScrimUserRef {
    const u = users.get(id);
    if (!u) throw new AppError('INTERNAL_ERROR', undefined, { message: `내전 사용자 없음` });
    return { id: u.id, nickname: u.nickname, avatar_url: discordAvatarUrl(u.discordId, u.discordAvatar) };
  }

  gameRef(game: Game) {
    const code = GameCode.safeParse(game.code);
    if (!code.success) throw new AppError('INTERNAL_ERROR', undefined, { message: `알 수 없는 게임 코드` });
    return {
      code: code.data,
      name: game.name,
      has_positions: game.hasPositions,
      has_teams: game.hasTeams,
      positions: game.hasPositions ? game.positions : [],
    };
  }

  /** 개인 순위 결과의 1위 사용자 id(목록 outcome용) */
  private winnerOf(r: ResultRow | undefined): string | null {
    if (!r || r.status !== 'approved') return null;
    const p = readPlacements(r.placements);
    return p?.find((x) => x.placement === 1)?.user_id ?? null;
  }

  /** S3 result_status·outcome(4-1). latest = 가장 최근 결과 행 */
  private resultSummary(scrim: Scrim, game: Game, latest: ResultRow | undefined, users: Map<string, UserRow>) {
    let outcome: ScrimOutcome | null = null;
    if (scrim.status === 'finished' && latest && latest.status === 'approved') {
      if (game.hasTeams) {
        outcome = latest.winnerTeam ? { winner_team: latest.winnerTeam, winner: null } : null;
      } else {
        const w = this.winnerOf(latest);
        outcome = { winner_team: null, winner: w && users.has(w) ? this.userRef(users, w) : null };
      }
    }
    return { result_status: latest?.status ?? null, outcome };
  }

  /** 요약 공통 필드. players = 그 내전의 joined·waitlist·no_show 행(cancelled 제외해도 되고 포함해도 된다) */
  private summaryFields(
    scrim: Scrim,
    game: Game,
    players: PlayerRow[],
    users: Map<string, UserRow>,
    viewerId: string,
    now: Date,
    latest: ResultRow | undefined,
  ) {
    const joined = players.filter((p) => p.status === 'joined');
    const noShow = players.filter((p) => p.status === 'no_show');
    const waitlist = players.filter((p) => p.status === 'waitlist');
    const mine = players.find((p) => p.userId === viewerId);
    const myStatus: MyScrimStatus | null = mine && mine.status !== 'cancelled' ? mine.status : null;
    const open = isOpenStatus(scrim.status);
    const openPositions =
      open && scrim.usePositions
        ? computeOpenPositions(
            game.positions,
            scrim.capacity,
            joined.map((p) => p.preferredPositions[0] ?? null),
          )
        : [];
    return {
      id: scrim.id,
      game: this.gameRef(game),
      title: scrim.title,
      scheduled_at: scrim.scheduledAt.toISOString(),
      capacity: scrim.capacity,
      status: scrim.status,
      host: this.userRef(users, scrim.hostId),
      // 모집 중에는 no_show 행이 없다(노쇼는 시작 뒤에만) → 항상 joined + no_show
      joined_count: joined.length + noShow.length,
      waitlist_count: waitlist.length,
      options: { rated: scrim.rated, auto_balance: scrim.autoBalance, use_positions: scrim.usePositions },
      steam_app:
        scrim.steamAppId !== null && scrim.steamAppName ? { app_id: scrim.steamAppId, name: scrim.steamAppName } : null,
      open_positions: openPositions,
      join_closed: isJoinClosed(scrim.scheduledAt, now),
      my_status: myStatus,
      created_at: scrim.createdAt.toISOString(),
      ...this.resultSummary(scrim, game, latest, users),
    };
  }

  /** 목록 카드 여러 개(페이지 단위). 참가자·결과는 내전 id IN 한 번씩, 사용자는 방장·1위 id IN 한 번 */
  async summaries(scrims: Scrim[], viewerId: string, now: Date): Promise<ScrimSummary[]> {
    if (scrims.length === 0) return [];
    const games = await this.gamesById();
    const ids = scrims.map((s) => s.id);
    const players = (await this.prisma.scrimPlayer.findMany({
      where: { scrimId: { in: ids }, status: { in: ['joined', 'waitlist', 'no_show'] } },
      select: {
        id: true,
        scrimId: true,
        userId: true,
        status: true,
        preferredPositions: true,
        joinedAt: true,
        noShowMarkedAt: true,
        position: true,
        team: true,
      },
    })) as PlayerRow[];
    const byScrim = new Map<string, PlayerRow[]>();
    for (const p of players) {
      const list = byScrim.get(p.scrimId) ?? [];
      list.push(p);
      byScrim.set(p.scrimId, list);
    }
    // 내전별 최근 결과 1행(4-1 DISTINCT ON과 같은 결과를 조회 1회 + 메모리 선택으로). 내전당 결과 행은 반려 횟수 + 1개뿐
    const results = await this.prisma.scrimResult.findMany({
      where: { scrimId: { in: ids } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const latestByScrim = new Map<string, ResultRow>();
    for (const r of [...results].sort(latestFirst)) if (!latestByScrim.has(r.scrimId)) latestByScrim.set(r.scrimId, r);
    const winnerIds = scrims.map((s) => this.winnerOf(latestByScrim.get(s.id))).filter((x): x is string => x !== null);
    const users = await this.usersById([...scrims.map((s) => s.hostId), ...winnerIds]);
    return scrims.map((s) => {
      const game = games.get(s.gameId);
      if (!game) throw new AppError('INTERNAL_ERROR', undefined, { message: '내전 게임 없음' });
      return ScrimSummary.parse(
        this.summaryFields(s, game, byScrim.get(s.id) ?? [], users, viewerId, now, latestByScrim.get(s.id)),
      );
    });
  }

  /** 상세(계약 S2 4-2, S3 4-1). 없으면 NOT_FOUND */
  async detail(scrimId: string, viewer: AuthUser, now: Date): Promise<ScrimDetail> {
    const scrim = await this.prisma.scrim.findUnique({ where: { id: scrimId } });
    if (!scrim) throw new AppError('NOT_FOUND');
    const game = await this.prisma.game.findUnique({ where: { id: scrim.gameId } });
    if (!game) throw new AppError('INTERNAL_ERROR', undefined, { message: '내전 게임 없음' });
    const players = (await this.prisma.scrimPlayer.findMany({
      where: { scrimId, status: { in: ['joined', 'waitlist', 'no_show'] } },
    })) as PlayerRow[];
    const results = (await this.prisma.scrimResult.findMany({ where: { scrimId } })).sort(latestFirst);
    const latest = results[0];
    const hasActive = results.some((r) => isActiveResultStatus(r.status));
    const history =
      latest && latest.status === 'approved'
        ? await this.prisma.ratingHistory.findMany({ where: { scrimId } })
        : [];
    const latestPlacements = latest ? readPlacements(latest.placements) : null;
    const historySeasonId = history[0]?.seasonId;
    const historySeason = historySeasonId
      ? await this.prisma.season.findUnique({ where: { id: historySeasonId } })
      : null;

    const users = await this.usersById([
      scrim.hostId,
      ...players.map((p) => p.userId),
      ...(latest ? [latest.submittedById, latest.approvedById, latest.rejectedById].filter((x): x is string => x !== null) : []),
      ...(latestPlacements ?? []).map((p) => p.user_id),
      ...history.map((h) => h.userId),
    ]);
    const base = this.summaryFields(scrim, game, players, users, viewer.id, now, latest);

    const slots = orderSlots(players, scrim.hostId);
    const skills = await this.ratingInputs.forUsers(game, slots.map((p) => p.userId), now);
    const waitRows = orderWaitlist(players.filter((p) => p.status === 'waitlist'));

    const mine = players.find((p) => p.userId === viewer.id);
    const myStatus = base.my_status;
    const isHost = scrim.hostId === viewer.id;
    const isAdmin = viewer.role === 'admin';
    const open = isOpenStatus(scrim.status);
    const restriction = await this.restriction.compute(viewer.id, now);
    const restrictedUntil = restriction.restricted && restriction.until ? restriction.until : null;
    const joined = players.filter((p) => p.status === 'joined');
    const joinedCount = joined.length;
    const active = myStatus === 'joined' || myStatus === 'waitlist';
    const waitIdx = waitRows.findIndex((p) => p.userId === viewer.id);

    // S3 viewer(shared ScrimViewer 주석 규칙)
    const hostOrAdmin = isHost || isAdmin;
    const blueJoined = joined.filter((p) => p.team === 'blue').length;
    const orangeJoined = joined.filter((p) => p.team === 'orange').length;
    const bothTeams = blueJoined > 0 && orangeJoined > 0;
    const canEditTeams =
      hostOrAdmin && game.hasTeams && (scrim.status === 'full' || scrim.status === 'playing') && !hasActive;
    const pending = latest && latest.status === 'pending' ? latest : null;

    const slotSkill = (userId: string): SkillInput => {
      const s = skills.get(userId);
      if (!s) throw new AppError('INTERNAL_ERROR', undefined, { message: '실력값 입력 없음' });
      return s;
    };

    return ScrimDetail.parse({
      ...base,
      rules: scrim.rules,
      started_at: scrim.startedAt?.toISOString() ?? null,
      cancelled_at: scrim.cancelledAt?.toISOString() ?? null,
      cancel_reason: scrim.cancelReason,
      updated_at: scrim.updatedAt.toISOString(),
      players: slots.map((p) => {
        const s = slotSkill(p.userId);
        return {
          user: this.userRef(users, p.userId),
          status: p.status,
          is_host: p.userId === scrim.hostId,
          preferred_positions: p.preferredPositions,
          joined_at: p.joinedAt.toISOString(),
          position: p.position,
          team: p.team,
          no_show_marked_at: p.status === 'no_show' ? (p.noShowMarkedAt?.toISOString() ?? null) : null,
          position_preference:
            p.team !== null && p.position !== null && scrim.usePositions
              ? positionPreferenceOf(p.preferredPositions, p.position)
              : null,
          skill: s.skill,
          is_new: s.isNew,
        };
      }),
      waitlist: waitRows.map((p, i) => ({
        order: i + 1,
        user: this.userRef(users, p.userId),
        preferred_positions: p.preferredPositions,
        joined_at: p.joinedAt.toISOString(),
      })),
      viewer: {
        status: myStatus,
        waitlist_order: waitIdx >= 0 ? waitIdx + 1 : null,
        preferred_positions: active && mine ? mine.preferredPositions : [],
        is_host: isHost,
        restricted_until: restrictedUntil?.toISOString() ?? null,
        can_join: open && !base.join_closed && !active && restrictedUntil === null,
        can_leave: open && !base.join_closed && active && !isHost,
        can_edit: isHost && open,
        can_cancel: hostOrAdmin && open,
        can_start:
          hostOrAdmin &&
          open &&
          canStartScrim({ requiresFull: game.startRequiresFull, capacity: scrim.capacity, joinedCount }),
        can_mark_no_show:
          isAdmin &&
          (scrim.status === 'playing' || scrim.status === 'finished') &&
          isNoShowMarkWindowOpen(scrim.scheduledAt, now, this.config.scrim.noShowMarkWindowDays),
        can_edit_teams: canEditTeams,
        can_balance:
          canEditTeams && scrim.autoBalance && joinedCount >= BALANCE_PLAYERS_MIN && joinedCount <= BALANCE_PLAYERS_MAX,
        can_submit_result:
          hostOrAdmin &&
          scrim.status === 'playing' &&
          !hasActive &&
          (game.hasTeams ? bothTeams : joinedCount >= BALANCE_PLAYERS_MIN),
        can_withdraw_result: pending !== null && (pending.submittedById === viewer.id || isHost),
        can_review_result: isAdmin && pending !== null && pending.submittedById !== viewer.id,
      },
      balance: game.hasTeams && bothTeams ? this.teamsView(scrim, game, slots, slotSkill) : null,
      result: latest
        ? this.resultView(scrim, game, latest, latestPlacements, history, historySeason, players, users)
        : null,
    });
  }

  /** 저장된 팀 요약(4-1 balance). 대상 = joined && team(노쇼 제외), 순서 = 슬롯 순서 */
  private teamsView(scrim: Scrim, game: Game, slots: PlayerRow[], skillOf: (id: string) => SkillInput): ScrimTeamsView {
    const member = (p: PlayerRow) => {
      const s = skillOf(p.userId);
      return { userId: p.userId, skill: s.skill, rating: s.rating, preferredPositions: p.preferredPositions, position: p.position };
    };
    const joined = slots.filter((p) => p.status === 'joined');
    const ev = evaluateTeams({
      blue: joined.filter((p) => p.team === 'blue').map(member),
      orange: joined.filter((p) => p.team === 'orange').map(member),
      usePositions: teamsUsePositions(scrim, game),
    });
    const preview = scrim.rated
      ? previewTeamElo({
          blueAvg: ev.blue.ratingAvg,
          orangeAvg: ev.orange.ratingAvg,
          k: this.config.rating.kBase,
          lossRatio: this.config.rating.lossRatio,
        })
      : null;
    return {
      blue: teamSideView(ev.blue, preview?.blue ?? null),
      orange: teamSideView(ev.orange, preview?.orange ?? null),
      blue_win_probability: roundProbability(ev.blueWinProbability),
      power_diff: roundHalfAwayFromZero(ev.powerDiff),
      position_cost: roundHalfAwayFromZero(ev.positionCost),
      unassigned_user_ids: joined.filter((p) => p.team === null).map((p) => p.userId),
    };
  }

  /** 최근 결과 행 → ScrimResultView(4-1 result) */
  private resultView(
    scrim: Scrim,
    game: Game,
    r: ResultRow,
    placements: { user_id: string; placement: number }[] | null,
    history: RatingHistory[],
    historySeason: Season | null,
    players: PlayerRow[],
    users: Map<string, UserRow>,
  ): ScrimResultView {
    const ref = (id: string | null) => (id === null ? null : this.userRef(users, id));
    const sortedPlacements = [...(placements ?? [])].sort((a, b) => a.placement - b.placement);
    const ratingStatus = !scrim.rated
      ? 'not_rated'
      : r.status === 'approved'
        ? history.length > 0
          ? 'applied'
          : 'skipped'
        : 'waiting';

    let changes: ScrimRatingChange[] = [];
    let season: ScrimResultView['season'] = null;
    if (ratingStatus === 'applied') {
      const teamOf = new Map(players.map((p) => [p.userId, p.team]));
      const historyUsers = new Set(history.map((h) => h.userId));
      // 개인 순위: 이력 행이 있는 사용자만 placement 오름차순으로 1..M 다시 매김(core selectRatedParticipants와 같은 규칙)
      const reRank = new Map(
        sortedPlacements.filter((p) => historyUsers.has(p.user_id)).map((p, i) => [p.user_id, i + 1] as const),
      );
      const m = history.length;
      changes = [...history]
        .sort((a, b) => {
          const d = b.eloAfter - b.eloBefore - (a.eloAfter - a.eloBefore);
          if (d !== 0) return d;
          return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
        })
        .map((h) => {
          const team = game.hasTeams ? (teamOf.get(h.userId) ?? null) : null;
          const placement = game.hasTeams ? null : (reRank.get(h.userId) ?? null);
          const win = game.hasTeams
            ? team !== null && team === r.winnerTeam
            : placement !== null && isPlacementWin(placement, m);
          return {
            user: this.userRef(users, h.userId),
            team,
            placement,
            outcome: win ? ('win' as const) : ('loss' as const),
            elo_before: h.eloBefore,
            elo_after: h.eloAfter,
            delta: h.eloAfter - h.eloBefore,
            k_factor: h.kFactor,
          };
        });
      if (!historySeason) throw new AppError('INTERNAL_ERROR', undefined, { message: '이력 시즌 없음' });
      season = seasonRef(historySeason);
    }
    return {
      id: r.id,
      status: r.status,
      winner_team: game.hasTeams ? r.winnerTeam : null,
      placements: sortedPlacements
        .filter((p) => users.has(p.user_id))
        .map((p) => ({ user: this.userRef(users, p.user_id), placement: p.placement })),
      submitted_by: this.userRef(users, r.submittedById),
      submitted_at: r.createdAt.toISOString(),
      approved_by: ref(r.approvedById),
      approved_at: r.approvedAt?.toISOString() ?? null,
      rejected_by: ref(r.rejectedById),
      rejected_at: r.rejectedAt?.toISOString() ?? null,
      reject_reason: r.rejectReason,
      rating_status: ratingStatus,
      season,
      rating_changes: changes,
    };
  }
}
