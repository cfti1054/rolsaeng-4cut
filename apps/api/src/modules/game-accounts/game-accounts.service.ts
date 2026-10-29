import { Inject, Injectable } from '@nestjs/common';
import { kstDayWindow } from '@gcd/core';
import {
  GAME_ACCOUNT_SYNC_STATE_TRANSITIONS,
  GetMyGameAccountsResponse,
  SetPrimaryGameAccountResponse,
  STEAM_ACCOUNTS_MAX,
  SYNC_STATE_STALE_MS,
  SyncGameAccountResponse,
  canTransition,
} from '@gcd/shared';
import {
  advisoryXactLock,
  userGameAccountsLockKey,
  userSyncQuotaLockKey,
} from '../../common/advisory-lock';
import { AppError } from '../../common/app-error';
import { APP_CLOCK, type Clock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { secondsUntil } from './external-errors';
import { type AccountRow, type Db, GameAccountViews } from './game-account-views.service';
import { GameCatalog } from './game-catalog.service';
import { RiotLinkService } from './riot-link.service';
import { SyncEnqueuer } from './sync-enqueuer.service';

/**
 * 연동 계정 조회·해제·대표 지정·수동 새로고침(계약 S1 4절, 5-3, 7절, D41·D46·D56).
 */
@Injectable()
export class GameAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: GameCatalog,
    private readonly views: GameAccountViews,
    private readonly riotLink: RiotLinkService,
    private readonly enqueuer: SyncEnqueuer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  /** GET /me/game-accounts */
  async list(userId: string): Promise<GetMyGameAccountsResponse> {
    const now = this.clock.now();
    return GetMyGameAccountsResponse.parse({
      accounts: await this.views.listViews(userId),
      riot_verification: await this.riotLink.currentVerification(userId, now),
      sync_quota: await this.views.syncQuota(userId, now),
      limits: { riot_accounts_max: this.config.riot.accountsMax, steam_accounts_max: STEAM_ACCOUNTS_MAX },
    });
  }

  /** 본인 행 하나(code 포함). 없거나 남의 것이면 NOT_FOUND */
  private async ownRow(db: Db, userId: string, id: string): Promise<AccountRow> {
    const row = await db.gameAccount.findFirst({ where: { id, userId } });
    if (!row) throw new AppError('NOT_FOUND');
    return { ...row, code: await this.catalog.codeOf(row.gameId) };
  }

  /** 라이엇 행이면 같은 라이엇 ID의 lol·tft 조건, 스팀이면 그 행 */
  private async groupWhere(row: AccountRow): Promise<{ userId: string; externalId?: string; gameId?: { in: string[] }; id?: string }> {
    if (row.code === 'steam') return { userId: row.userId, id: row.id };
    return { userId: row.userId, externalId: row.externalId, gameId: { in: await this.catalog.idsOf('riot') } };
  }

  /** DELETE /me/game-accounts/:id (5-3) */
  async unlink(userId: string, id: string): Promise<void> {
    await this.ownRow(this.prisma, userId, id);
    await this.prisma.$transaction(async (tx) => {
      await advisoryXactLock(tx, userGameAccountsLockKey(userId));
      const row = await this.ownRow(tx, userId, id);
      const group = await this.groupWhere(row);
      const wasPrimary = row.code !== 'steam' && row.isPrimary;
      await tx.gameAccount.deleteMany({ where: group });
      if (!wasPrimary) return;
      // 대표 해제 → 남은 라이엇 ID 중 가장 먼저 연동한 것(verified_at, 같으면 lol 행 id 순) 승격(D56)
      const { lol } = await this.catalog.ids();
      const next = await tx.gameAccount.findFirst({
        where: { userId, gameId: lol },
        orderBy: [{ verifiedAt: 'asc' }, { id: 'asc' }],
      });
      if (!next) return;
      await tx.gameAccount.updateMany({
        where: { userId, externalId: next.externalId, gameId: { in: await this.catalog.idsOf('riot') } },
        data: { isPrimary: true },
      });
    });
  }

  /** POST /me/game-accounts/:id/primary (D56). 기존 대표 false → 대상 true 순서(부분 고유 인덱스) */
  async setPrimary(userId: string, id: string): Promise<SetPrimaryGameAccountResponse> {
    const row = await this.ownRow(this.prisma, userId, id);
    if (row.code !== 'steam' && !row.isPrimary) {
      await this.prisma.$transaction(async (tx) => {
        await advisoryXactLock(tx, userGameAccountsLockKey(userId));
        const target = await this.ownRow(tx, userId, id);
        if (target.isPrimary) return;
        const riotIds = await this.catalog.idsOf('riot');
        await tx.gameAccount.updateMany({
          where: { userId, gameId: { in: riotIds }, isPrimary: true },
          data: { isPrimary: false },
        });
        await tx.gameAccount.updateMany({
          where: { userId, externalId: target.externalId, gameId: { in: riotIds } },
          data: { isPrimary: true },
        });
      });
    }
    return SetPrimaryGameAccountResponse.parse({ accounts: await this.views.listViews(userId) });
  }

  /** POST /me/game-accounts/:id/sync (7절). 202 */
  async sync(userId: string, id: string): Promise<SyncGameAccountResponse> {
    // 1
    const row = await this.ownRow(this.prisma, userId, id);
    const provider = row.code === 'steam' ? 'steam' : 'riot';
    const key = provider === 'riot' ? this.config.riot.apiKey : this.config.steam.apiKey;
    if (!key) throw new AppError('GAME_PROVIDER_NOT_CONFIGURED');

    const now = this.clock.now();
    const staleBefore = new Date(now.getTime() - SYNC_STATE_STALE_MS);
    // 2
    const result = await this.prisma.$transaction(async (tx) => {
      await advisoryXactLock(tx, userSyncQuotaLockKey(userId));
      const group = await this.groupWhere(row);
      const targets = await tx.gameAccount.findMany({ where: group });
      if (targets.length === 0) throw new AppError('NOT_FOUND');
      const inProgress = targets.some(
        (t) => t.syncState !== 'idle' && t.syncStateAt !== null && t.syncStateAt.getTime() >= staleBefore.getTime(),
      );
      if (inProgress) return { consumed: false };
      const { start, end } = kstDayWindow(now);
      const used = await tx.gameAccountSyncRequest.count({ where: { userId, createdAt: { gte: start } } });
      if (used >= this.config.syncDailyLimit) {
        throw new AppError('SYNC_LIMIT_EXCEEDED', undefined, { retryAfterSec: secondsUntil(end, now) });
      }
      for (const t of targets) {
        // idle → queued, 또는 멈춘 queued/running → queued(멈춘 행 전용, 아래 WHERE의 sync_state_at 조건으로 보장)
        if (!canTransition(GAME_ACCOUNT_SYNC_STATE_TRANSITIONS, t.syncState, 'queued')) {
          throw new AppError('INTERNAL_ERROR', undefined, { message: `허용되지 않는 동기화 전이 ${t.syncState}→queued` });
        }
      }
      await tx.gameAccountSyncRequest.create({ data: { userId, gameAccountId: row.id, createdAt: now } });
      await tx.gameAccount.updateMany({
        where: {
          id: { in: targets.map((t) => t.id) },
          OR: [{ syncState: 'idle' }, { syncStateAt: null }, { syncStateAt: { lt: staleBefore } }],
        },
        data: { syncState: 'queued', syncStateAt: now },
      });
      return { consumed: true };
    });
    // 3 — 커밋 후 등록. 라이엇은 lol 행 id로
    if (result.consumed) {
      if (provider === 'riot') {
        const { lol } = await this.catalog.ids();
        const lolRow =
          row.code === 'lol'
            ? row
            : await this.prisma.gameAccount.findFirst({ where: { userId, externalId: row.externalId, gameId: lol } });
        await this.enqueuer.enqueue('riot-full', lolRow?.id ?? row.id, 'manual');
      } else {
        await this.enqueuer.enqueue('steam-playtime', row.id, 'manual');
      }
    }
    return SyncGameAccountResponse.parse({
      accounts: await this.views.listViews(userId),
      sync_quota: await this.views.syncQuota(userId, now),
      quota_consumed: result.consumed,
    });
  }
}
