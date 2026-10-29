import { Inject, Injectable } from '@nestjs/common';
import {
  canStartScrim,
  computeOpenPositions,
  isJoinClosed,
  isNoShowMarkWindowOpen,
  orderWaitlist,
} from '@gcd/core';
import {
  GameCode,
  type MyScrimStatus,
  ScrimDetail,
  ScrimSummary,
  type ScrimUserRef,
} from '@gcd/shared';
import type { Game, Scrim, ScrimPlayer, User } from '@prisma/client';
import { AppError } from '../../common/app-error';
import type { AuthUser } from '../../common/decorators/current-user';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { discordAvatarUrl } from '../users/me.mapper';
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

/** 고정 정원 게임(capacity_min = capacity_max, 롤 10) */
export function isFixedCapacity(game: Pick<Game, 'capacityMin' | 'capacityMax'>): boolean {
  return game.capacityMin === game.capacityMax;
}

/**
 * ScrimSummary·ScrimDetail 조립(계약 S2 4-2). 모두 shared 스키마 parse를 거친다(S1 D38 — 사용자는
 * ScrimUserRef(id·nickname·avatar_url)만, email·discord_id 미포함).
 * select·include 없이 테이블별로 한 번씩 읽는다(N+1 없음): 내전 → 게임 → 참가자(내전 id IN) → 사용자(id IN).
 */
@Injectable()
export class ScrimViews {
  constructor(
    private readonly prisma: PrismaService,
    private readonly restriction: ScrimRestrictionService,
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

  private gameRef(game: Game) {
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

  /** 요약 공통 필드. players = 그 내전의 joined·waitlist·no_show 행(cancelled 제외해도 되고 포함해도 된다) */
  private summaryFields(scrim: Scrim, game: Game, players: PlayerRow[], users: Map<string, UserRow>, viewerId: string, now: Date) {
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
      open_positions: openPositions,
      join_closed: isJoinClosed(scrim.scheduledAt, now),
      my_status: myStatus,
      created_at: scrim.createdAt.toISOString(),
    };
  }

  /** 목록 카드 여러 개(페이지 단위). 참가자는 내전 id IN 한 번, 사용자는 방장 id IN 한 번 */
  async summaries(scrims: Scrim[], viewerId: string, now: Date): Promise<ScrimSummary[]> {
    if (scrims.length === 0) return [];
    const games = await this.gamesById();
    const players = (await this.prisma.scrimPlayer.findMany({
      where: { scrimId: { in: scrims.map((s) => s.id) }, status: { in: ['joined', 'waitlist', 'no_show'] } },
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
    const users = await this.usersById(scrims.map((s) => s.hostId));
    return scrims.map((s) => {
      const game = games.get(s.gameId);
      if (!game) throw new AppError('INTERNAL_ERROR', undefined, { message: '내전 게임 없음' });
      return ScrimSummary.parse(this.summaryFields(s, game, byScrim.get(s.id) ?? [], users, viewerId, now));
    });
  }

  /** 상세(계약 S2 4-2). 없으면 NOT_FOUND */
  async detail(scrimId: string, viewer: AuthUser, now: Date): Promise<ScrimDetail> {
    const scrim = await this.prisma.scrim.findUnique({ where: { id: scrimId } });
    if (!scrim) throw new AppError('NOT_FOUND');
    const game = await this.prisma.game.findUnique({ where: { id: scrim.gameId } });
    if (!game) throw new AppError('INTERNAL_ERROR', undefined, { message: '내전 게임 없음' });
    const players = (await this.prisma.scrimPlayer.findMany({
      where: { scrimId, status: { in: ['joined', 'waitlist', 'no_show'] } },
    })) as PlayerRow[];
    const users = await this.usersById([scrim.hostId, ...players.map((p) => p.userId)]);
    const base = this.summaryFields(scrim, game, players, users, viewer.id, now);

    const slots = players
      .filter((p) => p.status === 'joined' || p.status === 'no_show')
      .sort((a, b) => {
        const ah = a.userId === scrim.hostId ? 0 : 1;
        const bh = b.userId === scrim.hostId ? 0 : 1;
        if (ah !== bh) return ah - bh;
        const t = a.joinedAt.getTime() - b.joinedAt.getTime();
        if (t !== 0) return t;
        return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
      });
    const waitRows = orderWaitlist(players.filter((p) => p.status === 'waitlist'));

    const mine = players.find((p) => p.userId === viewer.id);
    const myStatus = base.my_status;
    const isHost = scrim.hostId === viewer.id;
    const isAdmin = viewer.role === 'admin';
    const open = isOpenStatus(scrim.status);
    const restriction = await this.restriction.compute(viewer.id, now);
    const restrictedUntil = restriction.restricted && restriction.until ? restriction.until : null;
    const joinedCount = players.filter((p) => p.status === 'joined').length;
    const active = myStatus === 'joined' || myStatus === 'waitlist';
    const waitIdx = waitRows.findIndex((p) => p.userId === viewer.id);

    return ScrimDetail.parse({
      ...base,
      rules: scrim.rules,
      started_at: scrim.startedAt?.toISOString() ?? null,
      cancelled_at: scrim.cancelledAt?.toISOString() ?? null,
      cancel_reason: scrim.cancelReason,
      updated_at: scrim.updatedAt.toISOString(),
      players: slots.map((p) => ({
        user: this.userRef(users, p.userId),
        status: p.status,
        is_host: p.userId === scrim.hostId,
        preferred_positions: p.preferredPositions,
        joined_at: p.joinedAt.toISOString(),
        position: p.position,
        team: p.team,
        no_show_marked_at: p.status === 'no_show' ? (p.noShowMarkedAt?.toISOString() ?? null) : null,
      })),
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
        can_cancel: (isHost || isAdmin) && open,
        can_start:
          (isHost || isAdmin) &&
          open &&
          canStartScrim({ fixedCapacity: isFixedCapacity(game), capacity: scrim.capacity, joinedCount }),
        can_mark_no_show:
          isAdmin &&
          (scrim.status === 'playing' || scrim.status === 'finished') &&
          isNoShowMarkWindowOpen(scrim.scheduledAt, now, this.config.scrim.noShowMarkWindowDays),
      },
      balance: null,
      result: null,
    });
  }
}
