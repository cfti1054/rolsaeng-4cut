import { Inject, Injectable, Logger } from '@nestjs/common';
import { computeMainPosition, isMatchesCacheStale } from '@gcd/core';
import {
  GetUserProfileResponse,
  LolMatchSummary,
  PROFILE_RECENT_MATCHES_LIMIT,
  type ProfileBadge,
  ProfileRecentMatches,
  ProfileTierCard,
  RANKED_QUEUE_BY_GAME,
  RECENT_MATCHES_MAX,
  RecentLolMatch,
  parseSeasonBadgeCode,
} from '@gcd/shared';
import { AppError } from '../../common/app-error';
import { APP_CLOCK, type Clock } from '../../common/clock';
import { DATA_DRAGON, type DataDragon } from '../../integrations/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { type AccountRow, GameAccountViews, primaryRiotRows } from '../game-accounts/game-account-views.service';
import { SyncEnqueuer } from '../game-accounts/sync-enqueuer.service';
import { seasonRef } from '../ratings/seasons.service';
import { DEV_DISCORD_ID_PREFIX, discordAvatarUrl } from '../users/me.mapper';
import { ProfileScrimService } from './profile-scrim.service';

/** 최근 실패가 이 시간 안이면 프로필 조회로 전적 갱신을 다시 넣지 않는다(D50) */
export const PROFILE_REFRESH_ERROR_BACKOFF_MS = 30 * 60 * 1000;

/**
 * GET /users/:id/profile (계약 S1 8절). 대표 라이엇 계정 기준 티어·주 포지션·최근 전적.
 * scrim은 S3부터 항상 객체(ProfileScrim, D119), badges는 S4부터 항상 배열(D159). 외부 식별자는 응답 스키마 parse로 걸러진다(D38).
 */
@Injectable()
export class ProfileService {
  private readonly log = new Logger('ProfileService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly views: GameAccountViews,
    private readonly enqueuer: SyncEnqueuer,
    private readonly scrimBlock: ProfileScrimService,
    @Inject(APP_CLOCK) private readonly clock: Clock,
    @Inject(DATA_DRAGON) private readonly ddragon: DataDragon,
  ) {}

  async getProfile(viewerId: string, userId: string): Promise<GetUserProfileResponse> {
    const now = this.clock.now();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('NOT_FOUND');
    const isSelf = viewerId === userId;

    const rows = await this.views.loadRows(userId);
    const { lol, tft } = primaryRiotRows(rows);

    const tiers: ProfileTierCard[] = [];
    for (const r of [lol, tft]) {
      if (!r || r.code === 'steam') continue;
      tiers.push(
        ProfileTierCard.parse({
          game_account_id: r.id,
          game: r.code,
          queue: RANKED_QUEUE_BY_GAME[r.code],
          rank: await this.views.latestRank(r),
          synced_at: r.lastSyncedAt?.toISOString() ?? null,
        }),
      );
    }

    let mainPosition: GetUserProfileResponse['main_position'] = null;
    let recent: ProfileRecentMatches | null = null;
    if (lol) {
      const matches = await this.loadMatches(lol);
      mainPosition = computeMainPosition(matches.map((m) => m.summary.position));
      recent = ProfileRecentMatches.parse({
        items: await this.toRecentItems(matches.slice(0, PROFILE_RECENT_MATCHES_LIMIT)),
        synced_at: lol.matchesSyncedAt?.toISOString() ?? null,
        refresh_queued: await this.maybeQueueMatches(lol, now),
      });
    }

    return GetUserProfileResponse.parse({
      user: {
        id: user.id,
        nickname: user.nickname,
        role: user.role,
        avatar_url: discordAvatarUrl(user.discordId, user.discordAvatar),
        discord_linked: Boolean(user.discordId && !user.discordId.startsWith(DEV_DISCORD_ID_PREFIX)),
        joined_at: user.createdAt.toISOString(),
      },
      is_self: isSelf,
      game_accounts: await this.views.toViews(rows),
      tiers,
      main_position: mainPosition,
      recent_matches: recent,
      sync_quota: isSelf ? await this.views.syncQuota(userId, now) : null,
      scrim: await this.scrimBlock.forUser(userId, now),
      badges: await this.loadBadges(userId),
    });
  }

  /** 획득 뱃지(계약 S4 4-4). earned_at DESC, id ASC. 표마다 한 번씩 읽는다(N+1 없음) */
  private async loadBadges(userId: string): Promise<ProfileBadge[]> {
    const rows = await this.prisma.userBadge.findMany({
      where: { userId },
      orderBy: [{ earnedAt: 'desc' }, { id: 'asc' }],
    });
    if (rows.length === 0) return [];
    const badges = await this.prisma.badge.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.badgeId))] } } });
    const seasonIds = [...new Set(rows.flatMap((r) => (r.seasonId ? [r.seasonId] : [])))];
    const seasons = seasonIds.length ? await this.prisma.season.findMany({ where: { id: { in: seasonIds } } }) : [];
    const badgeById = new Map(badges.map((b) => [b.id, b]));
    const seasonById = new Map(seasons.map((s) => [s.id, s]));
    return rows.flatMap((r) => {
      const badge = badgeById.get(r.badgeId);
      if (!badge) return [];
      const season = r.seasonId ? seasonById.get(r.seasonId) : undefined;
      const parsed = parseSeasonBadgeCode(badge.code);
      return [
        {
          id: r.id,
          code: badge.code,
          name: badge.name,
          description: badge.description,
          earned_at: r.earnedAt.toISOString(),
          season: season ? seasonRef(season) : null,
          game: parsed?.game ?? null,
          place: parsed?.place ?? null,
        },
      ];
    });
  }

  /** 대표 lol 행의 최신 20경기(형식이 깨진 summary 행은 건너뜀) */
  private async loadMatches(lol: AccountRow) {
    const rows = await this.prisma.recentMatch.findMany({
      where: { gameAccountId: lol.id },
      orderBy: [{ playedAt: 'desc' }, { id: 'asc' }],
      take: RECENT_MATCHES_MAX,
    });
    const out: { id: string; playedAt: Date; win: boolean; summary: LolMatchSummary }[] = [];
    for (const r of rows) {
      const summary = LolMatchSummary.safeParse(r.summary);
      if (!summary.success || r.win === null) continue;
      out.push({ id: r.id, playedAt: r.playedAt, win: r.win, summary: summary.data });
    }
    return out;
  }

  private async toRecentItems(
    matches: { id: string; playedAt: Date; win: boolean; summary: LolMatchSummary }[],
  ): Promise<RecentLolMatch[]> {
    const items: RecentLolMatch[] = [];
    for (const m of matches) {
      let champ: Awaited<ReturnType<DataDragon['champion']>> = null;
      try {
        champ = await this.ddragon.champion(m.summary.champion_id);
      } catch {
        champ = null;
      }
      const parsed = RecentLolMatch.safeParse({
        id: m.id,
        played_at: m.playedAt.toISOString(),
        win: m.win,
        champion_id: m.summary.champion_id,
        champion_key: m.summary.champion_key,
        champion_name: champ?.nameKo || m.summary.champion_key,
        champion_image_url: champ?.imageUrl ?? null,
        position: m.summary.position,
        kills: m.summary.kills,
        deaths: m.summary.deaths,
        assists: m.summary.assists,
        duration_sec: m.summary.duration_sec,
      });
      if (parsed.success) items.push(parsed.data);
    }
    return items;
  }

  /**
   * 6-2 riot-matches 조건: matches_synced_at이 null·6시간 초과, sync_state=idle, 30분 안 실패 기록 없음 → 등록(차감 없음).
   * sync_state가 idle이 아니면(이미 갱신 중) 등록 없이 true.
   */
  private async maybeQueueMatches(lol: AccountRow, now: Date): Promise<boolean> {
    if (lol.syncState !== 'idle') return true;
    if (!isMatchesCacheStale(lol.matchesSyncedAt, now)) return false;
    if (lol.lastSyncErrorAt && now.getTime() - lol.lastSyncErrorAt.getTime() < PROFILE_REFRESH_ERROR_BACKOFF_MS) {
      return false;
    }
    return this.enqueuer.enqueue('riot-matches', lol.id, 'profile-view');
  }
}
