import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  canStartScrim,
  isCapacityInRange,
  isJoinClosed,
  isNoShowMarkWindowOpen,
  placeNewParticipant,
  planRosterAfterChange,
  statusForJoinedCount,
  validatePreferredPositions,
  validateScrimSchedule,
} from '@gcd/core';
import {
  type CreateScrimRequest,
  type ErrorDetail,
  type JoinScrimRequest,
  type ListScrimsQuery,
  ListScrimsResponse,
  SCRIM_PLAYER_STATUS_TRANSITIONS,
  SCRIM_STATUS_TRANSITIONS,
  type ScrimDetail,
  type ScrimListStatus,
  type ScrimPlayerStatus,
  type ScrimStatus,
  type SetScrimNoShowRequest,
  type SteamAppRef,
  type UpdateScrimRequest,
  canTransition,
} from '@gcd/shared';
import type { Game, Prisma } from '@prisma/client';
import { AppError } from '../../common/app-error';
import { APP_CLOCK, type Clock } from '../../common/clock';
import type { AuthUser } from '../../common/decorators/current-user';
import { type LockedScrim, lockScrim } from '../../common/scrim-lock';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { SteamAppsService } from '../games/steam-apps.service';
import { decodeScrimCursor, encodeScrimCursor } from './scrim-cursor';
import { ScrimRestrictionService } from './scrim-restriction.service';
import { ScrimViews, isOpenStatus } from './scrim-views.service';

type Tx = Prisma.TransactionClient;

const TAB_STATUSES: Record<ScrimListStatus, ScrimStatus[]> = {
  open: ['recruiting', 'full'],
  playing: ['playing'],
  ended: ['finished', 'cancelled'],
};

const logger = new Logger('ScrimsService');

/** 상태 전이는 shared 맵 검사 후에만(계약 S2 5-0). 잠금 아래라 정상 흐름에서는 실패하지 않는다 */
export function assertScrimTransition(from: ScrimStatus, to: ScrimStatus): void {
  if (!canTransition(SCRIM_STATUS_TRANSITIONS, from, to)) {
    logger.error(`허용되지 않은 내전 상태 전이 ${from} → ${to}`);
    throw new AppError('INTERNAL_ERROR');
  }
}

export function assertPlayerTransition(from: ScrimPlayerStatus, to: ScrimPlayerStatus): void {
  if (!canTransition(SCRIM_PLAYER_STATUS_TRANSITIONS, from, to)) {
    logger.error(`허용되지 않은 참가자 상태 전이 ${from} → ${to}`);
    throw new AppError('INTERNAL_ERROR');
  }
}

/** 트랜잭션 첫 문장: 내전 행 잠금(5-0). 없으면 NOT_FOUND */
export async function lockOrNotFound(tx: Tx, id: string): Promise<LockedScrim> {
  const s = await lockScrim(tx, id);
  if (!s) throw new AppError('NOT_FOUND');
  return s;
}

export async function loadGame(tx: Pick<Tx, 'game'>, gameId: string): Promise<Game> {
  const g = await tx.game.findUnique({ where: { id: gameId } });
  if (!g) throw new AppError('INTERNAL_ERROR', undefined, { message: '내전 게임 없음' });
  return g;
}

export function countJoined(tx: Tx, scrimId: string): Promise<number> {
  return tx.scrimPlayer.count({ where: { scrimId, status: 'joined' } });
}

/**
 * 내전 모집·참가·대기열·노쇼(계약 S2 5절). 명단·상태를 바꾸는 경로는 모두 트랜잭션 + 내전 행 잠금(5-0) 뒤에 판정한다.
 * 계산(대기 순번·승격·정원·시작 조건·노쇼 판정)은 @gcd/core 함수만 쓴다.
 * 상태 변경 응답은 모두 커밋 후 다시 읽은 ScrimDetail(D87).
 */
@Injectable()
export class ScrimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly views: ScrimViews,
    private readonly restriction: ScrimRestrictionService,
    private readonly steamApps: SteamAppsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  // ---------------------------------------------------------------------------
  // 조회
  // ---------------------------------------------------------------------------

  /** GET /scrims (4-1) */
  async list(viewer: AuthUser, q: ListScrimsQuery): Promise<ListScrimsResponse> {
    const now = this.clock.now();
    const tab = q.status;
    const cursor = q.cursor === undefined ? null : decodeScrimCursor(q.cursor, tab);
    let gameId: string | undefined;
    if (q.game) {
      const g = await this.prisma.game.findUnique({ where: { code: q.game } });
      if (!g) return ListScrimsResponse.parse({ items: [], next_cursor: null });
      gameId = g.id;
    }
    const asc = tab === 'open';
    const dir = asc ? 'asc' : 'desc';
    const after: Prisma.ScrimWhereInput | undefined = cursor
      ? {
          OR: [
            { scheduledAt: asc ? { gt: cursor.scheduledAt } : { lt: cursor.scheduledAt } },
            { scheduledAt: cursor.scheduledAt, id: asc ? { gt: cursor.id } : { lt: cursor.id } },
          ],
        }
      : undefined;
    const rows = await this.prisma.scrim.findMany({
      where: { status: { in: TAB_STATUSES[tab] }, ...(gameId ? { gameId } : {}), ...(after ?? {}) },
      orderBy: [{ scheduledAt: dir }, { id: dir }],
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    const next = rows.length > q.limit && last ? encodeScrimCursor({ tab, scheduledAt: last.scheduledAt, id: last.id }) : null;
    return ListScrimsResponse.parse({ items: await this.views.summaries(page, viewer.id, now), next_cursor: next });
  }

  /** GET /scrims/:id */
  get(viewer: AuthUser, id: string): Promise<ScrimDetail> {
    return this.views.detail(id, viewer, this.clock.now());
  }

  // ---------------------------------------------------------------------------
  // 작성·수정 (5-1, 5-4)
  // ---------------------------------------------------------------------------

  private scheduleDetail(scheduledAt: Date, now: Date): ErrorDetail | null {
    const max = this.config.scrim.scheduleMaxDaysAhead;
    const r = validateScrimSchedule(scheduledAt, now, max);
    if (r === 'not_future') return { path: 'scheduled_at', message: '시작 시각은 지금보다 뒤여야 합니다.' };
    if (r === 'too_far') return { path: 'scheduled_at', message: `시작 시각은 최대 ${max}일 뒤까지 정할 수 있습니다.` };
    return null;
  }

  private capacityDetail(capacity: number, game: Game): ErrorDetail | null {
    if (isCapacityInRange(capacity, { min: game.capacityMin, max: game.capacityMax, step: game.capacityStep })) return null;
    const range = game.capacityMin === game.capacityMax ? `${game.capacityMin}명` : `${game.capacityMin}–${game.capacityMax}명`;
    const unit = game.capacityStep > 1 ? ` ${game.capacityStep}명 단위` : '';
    return { path: 'capacity', message: `이 게임의 정원은 ${range}${unit}입니다.` };
  }

  /** POST /scrims → 201 ScrimDetail */
  async create(user: AuthUser, body: CreateScrimRequest): Promise<ScrimDetail> {
    const now = this.clock.now();
    const game = await this.prisma.game.findUnique({ where: { code: body.game } });
    if (!game) throw new AppError('INTERNAL_ERROR', undefined, { message: `games 시드 없음: ${body.game}` });
    // 진행 방식 적용값(D77)
    const usePositions = body.use_positions && game.hasPositions;
    const autoBalance = body.auto_balance && game.hasTeams;
    const scheduledAt = new Date(body.scheduled_at);

    const details: ErrorDetail[] = [];
    const sd = this.scheduleDetail(scheduledAt, now);
    if (sd) details.push(sd);
    const cd = this.capacityDetail(body.capacity, game);
    if (cd) details.push(cd);
    const pv = validatePreferredPositions(body.host_preferred_positions, game.positions, usePositions);
    if (!pv.ok) details.push({ path: 'host_preferred_positions', message: pv.message });
    const steamAppId = body.steam_app_id ?? null;
    if (game.requiresSteamApp && steamAppId === null) {
      details.push({ path: 'steam_app_id', message: '스팀 게임을 골라 주세요.' });
    } else if (!game.requiresSteamApp && steamAppId !== null) {
      details.push({ path: 'steam_app_id', message: '이 게임은 스팀 게임을 고를 수 없습니다.' });
    }
    if (details.length > 0) throw new AppError('VALIDATION_FAILED', undefined, { details });

    await this.restriction.assertNotRestricted(user.id, now);
    const steamApp = steamAppId === null ? null : await this.resolveSteamApp(steamAppId);

    const id = await this.prisma.$transaction(async (tx) => {
      const scrim = await tx.scrim.create({
        data: {
          gameId: game.id,
          hostId: user.id,
          title: body.title,
          scheduledAt,
          capacity: body.capacity,
          status: statusForJoinedCount(1, body.capacity),
          rules: body.rules ?? null,
          rated: body.rated,
          autoBalance,
          usePositions,
          steamAppId: steamApp?.app_id ?? null,
          steamAppName: steamApp?.name ?? null,
        },
      });
      // 방장 = 참가자 1번(메인 기본값 4)
      await tx.scrimPlayer.create({
        data: {
          scrimId: scrim.id,
          userId: user.id,
          status: 'joined',
          preferredPositions: body.host_preferred_positions,
          joinedAt: now,
        },
      });
      return scrim.id;
    });
    return this.views.detail(id, user, now);
  }

  /** app id → 저장할 이름(D98). 외부 호출이 있어 트랜잭션 밖에서 부른다 */
  private async resolveSteamApp(appId: number): Promise<SteamAppRef> {
    const app = await this.steamApps.resolve(appId);
    if (!app) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        details: [{ path: 'steam_app_id', message: '스팀 상점에서 찾을 수 없는 게임입니다.' }],
      });
    }
    return app;
  }

  /**
   * PATCH의 steam_app_id는 잠금 트랜잭션 전에 이름을 정한다(외부 호출을 잠금 안에서 하지 않음).
   * 권한·게임 검사를 먼저 해서 방장이 아니면 상점을 부르지 않는다. 상태 검사는 트랜잭션에서 다시 한다.
   */
  private async steamAppForUpdate(user: AuthUser, id: string, appId: number): Promise<SteamAppRef> {
    const s = await this.prisma.scrim.findUnique({ where: { id } });
    if (!s) throw new AppError('NOT_FOUND');
    if (s.hostId !== user.id) throw new AppError('FORBIDDEN');
    const game = await loadGame(this.prisma, s.gameId);
    if (!game.requiresSteamApp) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        details: [{ path: 'steam_app_id', message: '이 게임은 스팀 게임을 고를 수 없습니다.' }],
      });
    }
    return this.resolveSteamApp(appId);
  }

  /** PATCH /scrims/:id (5-4) */
  async update(user: AuthUser, id: string, body: UpdateScrimRequest): Promise<ScrimDetail> {
    const now = this.clock.now();
    const steamApp = body.steam_app_id === undefined ? undefined : await this.steamAppForUpdate(user, id, body.steam_app_id);
    await this.prisma.$transaction(async (tx) => {
      const s = await lockOrNotFound(tx, id);
      if (s.hostId !== user.id) throw new AppError('FORBIDDEN');
      if (!isOpenStatus(s.status)) throw new AppError('SCRIM_NOT_RECRUITING');
      const game = await loadGame(tx, s.gameId);

      const scheduledAt = body.scheduled_at === undefined ? undefined : new Date(body.scheduled_at);
      const details: ErrorDetail[] = [];
      if (scheduledAt) {
        const sd = this.scheduleDetail(scheduledAt, now);
        if (sd) details.push(sd);
      }
      if (body.capacity !== undefined) {
        const cd = this.capacityDetail(body.capacity, game);
        if (cd) details.push(cd);
      }
      if (details.length > 0) throw new AppError('VALIDATION_FAILED', undefined, { details });

      const joinedCount = await countJoined(tx, s.id);
      if (body.capacity !== undefined && body.capacity < joinedCount) {
        throw new AppError('SCRIM_CAPACITY_BELOW_JOINED');
      }

      await tx.scrim.update({
        where: { id: s.id },
        data: {
          title: body.title,
          scheduledAt,
          capacity: body.capacity,
          rules: body.rules === undefined ? undefined : body.rules,
          rated: body.rated,
          autoBalance: body.auto_balance === undefined ? undefined : body.auto_balance && game.hasTeams,
          steamAppId: steamApp?.app_id,
          steamAppName: steamApp?.name,
        },
      });
      if (body.capacity !== undefined) {
        await this.applyRoster(tx, { ...s, capacity: body.capacity }, joinedCount);
      }
    });
    return this.views.detail(id, user, now);
  }

  /**
   * 자리 변화 뒤 대기열 승격 + recruiting ↔ full(5-3 6단계, 5-4 4단계, core planRosterAfterChange).
   * 승격자는 preferred_positions·joined_at을 그대로 둔다(메인 기본값 7).
   */
  private async applyRoster(tx: Tx, s: LockedScrim, joinedCount: number): Promise<void> {
    const waitlist = await tx.scrimPlayer.findMany({
      where: { scrimId: s.id, status: 'waitlist' },
      select: { id: true, joinedAt: true },
    });
    const plan = planRosterAfterChange({ capacity: s.capacity, joinedCount, waitlist });
    if (plan.promoteIds.length > 0) {
      assertPlayerTransition('waitlist', 'joined');
      const r = await tx.scrimPlayer.updateMany({
        where: { id: { in: plan.promoteIds }, status: 'waitlist' },
        data: { status: 'joined' },
      });
      if (r.count !== plan.promoteIds.length) throw new AppError('INTERNAL_ERROR', undefined, { message: '승격 행 수 불일치' });
    }
    if (plan.nextStatus !== s.status) {
      assertScrimTransition(s.status, plan.nextStatus);
      await tx.scrim.update({ where: { id: s.id }, data: { status: plan.nextStatus } });
    }
  }

  // ---------------------------------------------------------------------------
  // 참가·취소 (5-2, 5-3)
  // ---------------------------------------------------------------------------

  /** POST /scrims/:id/join */
  async join(user: AuthUser, id: string, body: JoinScrimRequest): Promise<ScrimDetail> {
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      const s = await lockOrNotFound(tx, id);
      if (!isOpenStatus(s.status)) throw new AppError('SCRIM_NOT_RECRUITING');
      if (isJoinClosed(s.scheduledAt, now)) throw new AppError('SCRIM_JOIN_CLOSED');
      const game = await loadGame(tx, s.gameId);
      const pv = validatePreferredPositions(body.preferred_positions, game.positions, s.usePositions);
      if (!pv.ok) {
        throw new AppError('VALIDATION_FAILED', undefined, { details: [{ path: 'preferred_positions', message: pv.message }] });
      }
      const mine = await tx.scrimPlayer.findFirst({ where: { scrimId: s.id, userId: user.id } });
      // 4. 이미 참가·대기 중 → 희망 포지션만(상태·순번 그대로, D81). 노쇼 제한과 무관(D83)
      if (mine && (mine.status === 'joined' || mine.status === 'waitlist')) {
        await tx.scrimPlayer.update({ where: { id: mine.id }, data: { preferredPositions: body.preferred_positions } });
        return;
      }
      // 5. 새 신청만 노쇼 제한
      await this.restriction.assertNotRestricted(user.id, now, tx);
      // 6
      const n = await countJoined(tx, s.id);
      const place = placeNewParticipant(n, s.capacity);
      if (mine) {
        assertPlayerTransition(mine.status, place);
        await tx.scrimPlayer.update({
          where: { id: mine.id },
          data: { status: place, preferredPositions: body.preferred_positions, joinedAt: now, position: null, team: null },
        });
      } else {
        await tx.scrimPlayer.create({
          data: { scrimId: s.id, userId: user.id, status: place, preferredPositions: body.preferred_positions, joinedAt: now },
        });
      }
      // 7
      if (place === 'joined') {
        const next = statusForJoinedCount(n + 1, s.capacity);
        if (next !== s.status) {
          assertScrimTransition(s.status, next);
          await tx.scrim.update({ where: { id: s.id }, data: { status: next } });
        }
      }
    });
    return this.views.detail(id, user, now);
  }

  /** DELETE /scrims/:id/join */
  async leave(user: AuthUser, id: string): Promise<ScrimDetail> {
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      const s = await lockOrNotFound(tx, id);
      if (!isOpenStatus(s.status)) throw new AppError('SCRIM_NOT_RECRUITING');
      if (isJoinClosed(s.scheduledAt, now)) throw new AppError('SCRIM_JOIN_CLOSED');
      if (s.hostId === user.id) throw new AppError('SCRIM_HOST_CANNOT_LEAVE');
      const mine = await tx.scrimPlayer.findFirst({ where: { scrimId: s.id, userId: user.id } });
      if (!mine || mine.status === 'cancelled') return;
      assertPlayerTransition(mine.status, 'cancelled');
      await tx.scrimPlayer.update({ where: { id: mine.id }, data: { status: 'cancelled' } });
      if (mine.status === 'joined') {
        await this.applyRoster(tx, s, await countJoined(tx, s.id));
      }
    });
    return this.views.detail(id, user, now);
  }

  // ---------------------------------------------------------------------------
  // 시작·모집 취소 (5-5)
  // ---------------------------------------------------------------------------

  /** POST /scrims/:id/start — 방장·운영진 */
  async start(user: AuthUser, id: string): Promise<ScrimDetail> {
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      const s = await lockOrNotFound(tx, id);
      if (s.hostId !== user.id && user.role !== 'admin') throw new AppError('FORBIDDEN');
      if (!isOpenStatus(s.status)) throw new AppError('SCRIM_NOT_RECRUITING');
      const game = await loadGame(tx, s.gameId);
      const joinedCount = await countJoined(tx, s.id);
      if (!canStartScrim({ requiresFull: game.startRequiresFull, capacity: s.capacity, joinedCount })) {
        throw new AppError('SCRIM_CANNOT_START');
      }
      assertScrimTransition(s.status, 'playing');
      // 대기열 행은 그대로(D95)
      await tx.scrim.update({ where: { id: s.id }, data: { status: 'playing', startedAt: now } });
    });
    return this.views.detail(id, user, now);
  }

  /** POST /scrims/:id/cancel — 방장(reason host)·운영진(reason admin) */
  async cancel(user: AuthUser, id: string): Promise<ScrimDetail> {
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      const s = await lockOrNotFound(tx, id);
      const isHost = s.hostId === user.id;
      if (!isHost && user.role !== 'admin') throw new AppError('FORBIDDEN');
      if (!isOpenStatus(s.status)) throw new AppError('SCRIM_NOT_RECRUITING');
      assertScrimTransition(s.status, 'cancelled');
      // 참가자 행은 그대로(이력, D80)
      await tx.scrim.update({
        where: { id: s.id },
        data: { status: 'cancelled', cancelledAt: now, cancelReason: isHost ? 'host' : 'admin' },
      });
    });
    return this.views.detail(id, user, now);
  }

  // ---------------------------------------------------------------------------
  // 노쇼 표시·정정 (5-7) — 운영진(@Roles('admin')은 컨트롤러)
  // ---------------------------------------------------------------------------

  async setNoShow(admin: AuthUser, id: string, targetUserId: string, body: SetScrimNoShowRequest): Promise<ScrimDetail> {
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      const s = await lockOrNotFound(tx, id);
      if (s.status !== 'playing' && s.status !== 'finished') throw new AppError('SCRIM_NO_SHOW_NOT_ALLOWED');
      const row = await tx.scrimPlayer.findFirst({ where: { scrimId: s.id, userId: targetUserId } });
      if (!row) throw new AppError('NOT_FOUND');
      if (row.status !== 'joined' && row.status !== 'no_show') throw new AppError('SCRIM_NO_SHOW_NOT_ALLOWED');
      if (body.no_show) {
        if (row.status === 'no_show') return;
        if (!isNoShowMarkWindowOpen(s.scheduledAt, now, this.config.scrim.noShowMarkWindowDays)) {
          throw new AppError('SCRIM_NO_SHOW_NOT_ALLOWED');
        }
        assertPlayerTransition('joined', 'no_show');
        await tx.scrimPlayer.update({
          where: { id: row.id },
          data: { status: 'no_show', noShowMarkedAt: now, noShowMarkedById: admin.id },
        });
      } else {
        if (row.status === 'joined') return;
        assertPlayerTransition('no_show', 'joined');
        await tx.scrimPlayer.update({
          where: { id: row.id },
          data: { status: 'joined', noShowMarkedAt: null, noShowMarkedById: null },
        });
      }
    });
    return this.views.detail(id, admin, now);
  }
}
