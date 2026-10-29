import { Inject, Injectable } from '@nestjs/common';
import { buildSyncQuota, kstDayWindow } from '@gcd/core';
import {
  GAME_PROVIDER_BY_CODE,
  GameAccountSyncError,
  GameAccountView,
  RANKED_QUEUE_BY_GAME,
  RankValue,
  RiotLinkVerificationView,
  formatRiotId,
  type GameCode,
  type SyncQuota,
} from '@gcd/shared';
import type { GameAccount, Prisma, RiotLinkVerification } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { DATA_DRAGON, type DataDragon } from '../../integrations/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { GameCatalog } from './game-catalog.service';

/** PrismaService 또는 트랜잭션 클라이언트 */
export type Db = PrismaService | Prisma.TransactionClient;

export type AccountRow = GameAccount & { code: GameCode };

/**
 * 계정 목록 정렬(계약 S1 4절): 대표 라이엇(lol, tft) → 부계정(verified_at 오름차순, 같으면 lol 행 id 순, 각 lol, tft) → 스팀.
 */
export function sortAccountRows(rows: readonly AccountRow[]): AccountRow[] {
  const riot = rows.filter((r) => GAME_PROVIDER_BY_CODE[r.code] === 'riot');
  const steam = rows.filter((r) => GAME_PROVIDER_BY_CODE[r.code] === 'steam');
  const groups = new Map<string, AccountRow[]>();
  for (const r of riot) {
    const g = groups.get(r.externalId) ?? [];
    g.push(r);
    groups.set(r.externalId, g);
  }
  const time = (d: Date | null) => (d ? d.getTime() : Number.MAX_SAFE_INTEGER);
  const ordered = [...groups.values()].map((g) => {
    const sorted = [...g].sort((a, b) => (a.code === b.code ? a.id.localeCompare(b.id) : a.code === 'lol' ? -1 : 1));
    const head = sorted[0] as AccountRow;
    return { rows: sorted, primary: g.some((r) => r.isPrimary), verifiedAt: time(head.verifiedAt), key: head.id };
  });
  ordered.sort(
    (a, b) =>
      Number(b.primary) - Number(a.primary) || a.verifiedAt - b.verifiedAt || a.key.localeCompare(b.key),
  );
  const steamSorted = [...steam].sort((a, b) => time(a.verifiedAt) - time(b.verifiedAt) || a.id.localeCompare(b.id));
  return [...ordered.flatMap((g) => g.rows), ...steamSorted];
}

/** 이 계정의 대표 라이엇 lol·tft 행(없으면 null) */
export function primaryRiotRows(rows: readonly AccountRow[]): { lol: AccountRow | null; tft: AccountRow | null } {
  const lol = rows.find((r) => r.code === 'lol' && r.isPrimary) ?? null;
  const tft = rows.find((r) => r.code === 'tft' && r.isPrimary) ?? null;
  return { lol, tft };
}

/**
 * GameAccountView·SyncQuota·RiotLinkVerificationView 조립. 모든 응답 조각은 shared 스키마로 parse해서
 * external_id·puuid가 섞여도 응답에 나가지 않게 한다(D38).
 */
@Injectable()
export class GameAccountViews {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: GameCatalog,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATA_DRAGON) private readonly ddragon: DataDragon,
  ) {}

  /** 사용자의 game_accounts 전부(code 포함, 4절 정렬) */
  async loadRows(userId: string, db: Db = this.prisma): Promise<AccountRow[]> {
    const rows = await db.gameAccount.findMany({ where: { userId } });
    const out: AccountRow[] = [];
    for (const r of rows) out.push({ ...r, code: await this.catalog.codeOf(r.gameId) });
    return sortAccountRows(out);
  }

  /** 행의 최신 티어 스냅샷(lol 솔로 / tft). 스팀·스냅샷 없음은 null. 형식이 깨진 값도 null */
  async latestRank(row: AccountRow, db: Db = this.prisma): Promise<RankValue | null> {
    if (row.code === 'steam') return null;
    const snap = await db.rankSnapshot.findFirst({
      where: { gameAccountId: row.id, queue: RANKED_QUEUE_BY_GAME[row.code] },
      orderBy: [{ capturedAt: 'desc' }, { createdAt: 'desc' }],
    });
    if (!snap) return null;
    const parsed = RankValue.safeParse({
      tier: snap.tier,
      division: snap.division,
      lp: snap.lp,
      wins: snap.wins,
      losses: snap.losses,
    });
    return parsed.success ? parsed.data : null;
  }

  async toView(row: AccountRow, db: Db = this.prisma): Promise<GameAccountView> {
    let ownedCount: number | null = null;
    if (row.code === 'steam') {
      const count = await db.steamPlaytime.count({ where: { gameAccountId: row.id } });
      ownedCount = count > 0 || row.lastSyncedAt !== null ? count : null;
    }
    const errCode = row.lastSyncError === null ? null : GameAccountSyncError.safeParse(row.lastSyncError);
    return GameAccountView.parse({
      id: row.id,
      game: row.code,
      provider: GAME_PROVIDER_BY_CODE[row.code],
      display_name: row.displayName,
      verified_at: (row.verifiedAt ?? row.createdAt).toISOString(),
      is_primary: row.isPrimary,
      rank: await this.latestRank(row, db),
      sync: {
        state: row.syncState,
        synced_at: row.lastSyncedAt?.toISOString() ?? null,
        matches_synced_at: row.code === 'lol' ? (row.matchesSyncedAt?.toISOString() ?? null) : null,
        error:
          errCode === null
            ? null
            : {
                code: errCode.success ? errCode.data : 'INTERNAL_ERROR',
                at: (row.lastSyncErrorAt ?? row.updatedAt).toISOString(),
              },
      },
      steam_owned_game_count: ownedCount,
    });
  }

  async toViews(rows: readonly AccountRow[], db: Db = this.prisma): Promise<GameAccountView[]> {
    const out: GameAccountView[] = [];
    for (const r of rows) out.push(await this.toView(r, db));
    return out;
  }

  /** 사용자 계정 전체 뷰(4절 정렬) */
  async listViews(userId: string, db: Db = this.prisma): Promise<GameAccountView[]> {
    return this.toViews(await this.loadRows(userId, db), db);
  }

  /** 오늘(KST) 수동 새로고침 사용 횟수 */
  async usedSyncCount(userId: string, now: Date, db: Db = this.prisma): Promise<number> {
    const { start } = kstDayWindow(now);
    return db.gameAccountSyncRequest.count({ where: { userId, createdAt: { gte: start } } });
  }

  async syncQuota(userId: string, now: Date, db: Db = this.prisma): Promise<SyncQuota> {
    return buildSyncQuota(await this.usedSyncCount(userId, now, db), this.config.syncDailyLimit, now);
  }

  /** riot_link_verifications 행 → 뷰. pending인데 만료 시각이 지났으면 expired로 보여준다(5-1) */
  async verificationView(v: RiotLinkVerification, now: Date): Promise<RiotLinkVerificationView> {
    let iconUrl: string | null = null;
    try {
      iconUrl = await this.ddragon.profileIconUrl(v.iconId);
    } catch {
      iconUrl = null;
    }
    const status = v.status === 'pending' && now.getTime() >= v.expiresAt.getTime() ? 'expired' : v.status;
    return RiotLinkVerificationView.parse({
      id: v.id,
      display_name: formatRiotId({ game_name: v.gameName, tag_line: v.tagLine }),
      icon_id: v.iconId,
      icon_image_url: iconUrl,
      status,
      expires_at: v.expiresAt.toISOString(),
      created_at: v.createdAt.toISOString(),
    });
  }
}
