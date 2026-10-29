import { Inject, Injectable, Logger } from '@nestjs/common';
import { kstDayWindow, pickVerificationIcon } from '@gcd/core';
import {
  ConfirmRiotVerificationResponse,
  LinkGameAccountResponse,
  RIOT_LINK_VERIFICATION_TRANSITIONS,
  RIOT_VERIFICATION_CHECK_INTERVAL_SEC,
  RIOT_VERIFICATION_DAILY_START_LIMIT,
  canTransition,
  formatRiotId,
  type RiotIdInput,
  type RiotLinkVerificationStatus,
} from '@gcd/shared';
import { advisoryXactLock, userGameAccountsLockKey } from '../../common/advisory-lock';
import { AppError } from '../../common/app-error';
import { APP_CLOCK, type Clock } from '../../common/clock';
import { classifyGameAccountUniqueViolation } from '../../common/unique-violation';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { RIOT_API, type RiotApi } from '../../integrations/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { callProvider, secondsUntil } from './external-errors';
import { type Db, GameAccountViews } from './game-account-views.service';
import { GameCatalog } from './game-catalog.service';
import { SyncEnqueuer } from './sync-enqueuer.service';

/** 난수 공급(테스트에서 고정할 수 있게 토큰으로 둔다) */
export const RANDOM = Symbol('RANDOM');
export type RandomFn = () => number;

function assertVerificationTransition(from: RiotLinkVerificationStatus, to: RiotLinkVerificationStatus): void {
  if (!canTransition(RIOT_LINK_VERIFICATION_TRANSITIONS, from, to)) {
    throw new AppError('INTERNAL_ERROR', undefined, { message: `허용되지 않는 소유 확인 전이 ${from}→${to}` });
  }
}

/**
 * 라이엇 연동: 프로필 아이콘 소유 확인(계약 S1 5-1, D32·D33·D51·D56·D60).
 */
@Injectable()
export class RiotLinkService {
  private readonly log = new Logger('RiotLinkService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: GameCatalog,
    private readonly views: GameAccountViews,
    private readonly enqueuer: SyncEnqueuer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_CLOCK) private readonly clock: Clock,
    @Inject(RIOT_API) private readonly riot: RiotApi,
    @Inject(RANDOM) private readonly random: RandomFn,
  ) {}

  private async riotIdCount(db: Db, userId: string): Promise<number> {
    const { lol } = await this.catalog.ids();
    return db.gameAccount.count({ where: { userId, gameId: lol } });
  }

  /** 그 PUUID의 lol 행이 있으면 본인 → ALREADY_LINKED_TO_ME, 타인 → ALREADY_LINKED */
  private async assertPuuidFree(db: Db, userId: string, puuid: string): Promise<void> {
    const { lol } = await this.catalog.ids();
    const existing = await db.gameAccount.findFirst({ where: { gameId: lol, externalId: puuid } });
    if (!existing) return;
    throw new AppError(existing.userId === userId ? 'GAME_ACCOUNT_ALREADY_LINKED_TO_ME' : 'GAME_ACCOUNT_ALREADY_LINKED');
  }

  /** 시작 `POST /me/game-accounts {provider:'riot'}` (5-1 시작 2–10단계) */
  async start(userId: string, riotId: RiotIdInput): Promise<LinkGameAccountResponse> {
    // 2
    if (!this.config.riot.apiKey) throw new AppError('GAME_PROVIDER_NOT_CONFIGURED');
    const now = this.clock.now();
    // 3
    if ((await this.riotIdCount(this.prisma, userId)) >= this.config.riot.accountsMax) {
      throw new AppError('GAME_ACCOUNT_LIMIT_REACHED');
    }
    // 4
    const day = kstDayWindow(now);
    const startedToday = await this.prisma.riotLinkVerification.count({
      where: { userId, createdAt: { gte: day.start } },
    });
    if (startedToday >= RIOT_VERIFICATION_DAILY_START_LIMIT) {
      throw new AppError('RATE_LIMITED', undefined, { retryAfterSec: secondsUntil(day.end, now) });
    }
    // 5
    const account = await callProvider(
      () => this.riot.getAccountByRiotId(riotId.game_name, riotId.tag_line, 'interactive'),
      'RIOT_ID_NOT_FOUND',
    );
    // 6
    await this.assertPuuidFree(this.prisma, userId, account.puuid);
    // 7
    const summoner = await callProvider(
      () => this.riot.getSummonerByPuuid(account.puuid, 'interactive'),
      'RIOT_SUMMONER_NOT_FOUND',
    );
    // 8
    const iconId = pickVerificationIcon(summoner.profileIconId, this.random);
    // 9
    const created = await this.prisma.$transaction(async (tx) => {
      assertVerificationTransition('pending', 'cancelled');
      await tx.riotLinkVerification.updateMany({
        where: { userId, status: 'pending' },
        data: { status: 'cancelled' },
      });
      return tx.riotLinkVerification.create({
        data: {
          userId,
          puuid: account.puuid,
          gameName: account.gameName,
          tagLine: account.tagLine,
          iconId,
          status: 'pending',
          expiresAt: new Date(now.getTime() + this.config.riot.verificationTtlSec * 1000),
          createdAt: now,
        },
      });
    });
    // 10
    return LinkGameAccountResponse.parse({
      provider: 'riot',
      verification: await this.views.verificationView(created, now),
    });
  }

  /** 확인 `POST …/riot-verifications/:id/confirm` (5-1 확인 1–6단계) */
  async confirm(userId: string, verificationId: string): Promise<ConfirmRiotVerificationResponse> {
    const now = this.clock.now();
    // 1
    const v = await this.prisma.riotLinkVerification.findFirst({ where: { id: verificationId, userId } });
    if (!v) throw new AppError('NOT_FOUND');
    // 2
    if (v.status === 'verified') return this.confirmedResponse(userId, v.id, now);
    if (v.status !== 'pending') throw new AppError('OWNERSHIP_CHECK_EXPIRED');
    if (now.getTime() >= v.expiresAt.getTime()) {
      assertVerificationTransition('pending', 'expired');
      await this.prisma.riotLinkVerification.updateMany({
        where: { id: v.id, status: 'pending' },
        data: { status: 'expired' },
      });
      throw new AppError('OWNERSHIP_CHECK_EXPIRED');
    }
    // 3 — 5초 간격. 조건부 update로 동시 확인 요청도 하나만 통과
    const intervalMs = RIOT_VERIFICATION_CHECK_INTERVAL_SEC * 1000;
    const checkedBefore = new Date(now.getTime() - intervalMs);
    const claimed = await this.prisma.riotLinkVerification.updateMany({
      where: {
        id: v.id,
        status: 'pending',
        OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lte: checkedBefore } }],
      },
      data: { lastCheckedAt: now, checkCount: { increment: 1 } },
    });
    if (claimed.count === 0) {
      const latest = await this.prisma.riotLinkVerification.findFirst({ where: { id: v.id, userId } });
      if (!latest || latest.status === 'cancelled' || latest.status === 'expired') {
        throw new AppError('OWNERSHIP_CHECK_EXPIRED');
      }
      if (latest.status === 'verified') return this.confirmedResponse(userId, v.id, now);
      const last = latest.lastCheckedAt ?? now;
      throw new AppError('RATE_LIMITED', undefined, {
        retryAfterSec: secondsUntil(new Date(last.getTime() + intervalMs), now),
      });
    }
    // 4
    if (!this.config.riot.apiKey) throw new AppError('GAME_PROVIDER_NOT_CONFIGURED');
    const summoner = await callProvider(
      () => this.riot.getSummonerByPuuid(v.puuid, 'interactive'),
      'RIOT_SUMMONER_NOT_FOUND',
    );
    if (summoner.profileIconId !== v.iconId) throw new AppError('OWNERSHIP_CHECK_FAILED');

    // 5
    const ids = await this.catalog.ids();
    let lolId: string;
    try {
      lolId = await this.prisma.$transaction(async (tx) => {
        await advisoryXactLock(tx, userGameAccountsLockKey(userId));
        if ((await this.riotIdCount(tx, userId)) >= this.config.riot.accountsMax) {
          throw new AppError('GAME_ACCOUNT_LIMIT_REACHED');
        }
        await this.assertPuuidFree(tx, userId, v.puuid);
        const hasRiot = (await tx.gameAccount.count({ where: { userId, gameId: { in: [ids.lol, ids.tft] } } })) > 0;
        const common = {
          userId,
          externalId: v.puuid,
          displayName: formatRiotId({ game_name: v.gameName, tag_line: v.tagLine }),
          verified: true,
          verifiedAt: now,
          isPrimary: !hasRiot,
          syncState: 'queued' as const,
          syncStateAt: now,
        };
        const lol = await tx.gameAccount.create({ data: { ...common, gameId: ids.lol } });
        await tx.gameAccount.create({ data: { ...common, gameId: ids.tft } });
        assertVerificationTransition('pending', 'verified');
        const done = await tx.riotLinkVerification.updateMany({
          where: { id: v.id, status: 'pending' },
          data: { status: 'verified', verifiedAt: now },
        });
        // 확인 사이에 취소·새 시작으로 pending이 아니게 됨 → 행 생성 되돌림
        if (done.count === 0) throw new AppError('OWNERSHIP_CHECK_EXPIRED');
        return lol.id;
      });
    } catch (err) {
      throw await this.mapInsertConflict(err, userId, v.puuid);
    }
    // 6 — 커밋 후 등록(횟수 차감 없음)
    await this.enqueuer.enqueue('riot-full', lolId, 'link');
    return this.confirmedResponse(userId, v.id, now);
  }

  /** 5-2a 라이엇 열: (game_id, external_id) → 소유자 다시 조회, 대표 인덱스 → INTERNAL_ERROR */
  private async mapInsertConflict(err: unknown, userId: string, puuid: string): Promise<unknown> {
    const kind = classifyGameAccountUniqueViolation(err);
    if (kind === null) return err;
    if (kind === 'external_id') {
      const { lol, tft } = await this.catalog.ids();
      const owner = await this.prisma.gameAccount.findFirst({
        where: { externalId: puuid, gameId: { in: [lol, tft] } },
      });
      if (owner) {
        return new AppError(owner.userId === userId ? 'GAME_ACCOUNT_ALREADY_LINKED_TO_ME' : 'GAME_ACCOUNT_ALREADY_LINKED');
      }
    }
    this.log.error(`라이엇 연동 insert 고유 제약 위반(${kind}) user=${userId} — 잠금 안에서는 생기지 않아야 함`);
    return new AppError('INTERNAL_ERROR', undefined, { cause: err });
  }

  /** verified 확인의 응답: 확인 + 그 라이엇 ID의 현재 lol·tft 행(해제됐으면 빈 배열) */
  private async confirmedResponse(userId: string, verificationId: string, now: Date): Promise<ConfirmRiotVerificationResponse> {
    const v = await this.prisma.riotLinkVerification.findFirst({ where: { id: verificationId, userId } });
    if (!v) throw new AppError('NOT_FOUND');
    const rows = (await this.views.loadRows(userId)).filter(
      (r) => r.externalId === v.puuid && (r.code === 'lol' || r.code === 'tft'),
    );
    return ConfirmRiotVerificationResponse.parse({
      verification: await this.views.verificationView(v, now),
      accounts: await this.views.toViews(rows),
    });
  }

  /** 취소 `DELETE …/riot-verifications/:id`: pending → cancelled, 이미 끝났으면 변경 없이 성공 */
  async cancel(userId: string, verificationId: string): Promise<void> {
    const v = await this.prisma.riotLinkVerification.findFirst({ where: { id: verificationId, userId } });
    if (!v) throw new AppError('NOT_FOUND');
    if (v.status !== 'pending') return;
    assertVerificationTransition('pending', 'cancelled');
    await this.prisma.riotLinkVerification.updateMany({
      where: { id: v.id, status: 'pending' },
      data: { status: 'cancelled' },
    });
  }

  /** GET /me/game-accounts의 riot_verification: 가장 최근 확인이 pending이면 그 값 */
  async currentVerification(userId: string, now: Date) {
    const latest = await this.prisma.riotLinkVerification.findFirst({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!latest || latest.status !== 'pending') return null;
    return this.views.verificationView(latest, now);
  }
}
