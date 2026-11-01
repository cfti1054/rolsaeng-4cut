import { Inject, Injectable } from '@nestjs/common';
import { resolveSeasonAt } from '@gcd/core';
import {
  type ActivityPeriod,
  BOT_RANKING_UNIT_BY_TYPE,
  BOT_UPCOMING_LIMIT,
  type BotRankingItem,
  type BotRankingType,
  type BotUpcomingScrim,
  type BotUserRating,
  type BotUserTier,
  GameCode,
  type GetBotRankingQueryByType,
  GetBotRankingResponse,
  GetBotUpcomingScrimsResponse,
  GetBotUserLookupResponse,
  RIOT_APEX_TIERS,
  type ScrimUserRef,
  type TierRankingGame,
  isLinkedDiscordId,
} from '@gcd/shared';
import type { z } from 'zod';
import { AppError } from '../../common/app-error';
import { APP_CLOCK, type Clock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { GameAccountViews, primaryRiotRows } from '../game-accounts/game-account-views.service';
import { RankingsReader } from '../rankings/rankings-reader.service';
import { SeasonsService, seasonRef } from '../ratings/seasons.service';
import { OPEN_STATUSES, ScrimViews } from '../scrims/scrim-views.service';
import { type BotUserSource, botUserRef } from './bot-user-ref';

type BotRankingQuery<T extends BotRankingType> = z.output<(typeof GetBotRankingQueryByType)[T]>;
export type BotRankingRequest = {
  [T in BotRankingType]: { type: T; query: BotRankingQuery<T> };
}[BotRankingType];

type Row = { rank: number; user: ScrimUserRef; value: number; detail: string | null; rank_change: number | null };

const EMPTY_CONTEXT = {
  game: null,
  season: null,
  is_final: false,
  period: null,
  period_start: null,
  period_end: null,
  app: null,
} as const;

/** `DIAMOND` → `Diamond` */
function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** 봇 tier detail(계약 S5 6-5): `Diamond II · 45 LP`, 마스터 이상은 디비전 생략 */
export function tierDetail(e: { tier: string; division: string | null; lp: number }): string {
  const apex = (RIOT_APEX_TIERS as readonly string[]).includes(e.tier);
  const head = apex || e.division === null ? titleCase(e.tier) : `${titleCase(e.tier)} ${e.division}`;
  return `${head} · ${e.lp} LP`;
}

/**
 * 봇 조회 조립(계약 S5 6-3·6-4·6-5). 순위는 웹과 같은 캐시 행(RankingsReader)만 읽는다(D215).
 */
@Injectable()
export class BotQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: GameAccountViews,
    private readonly seasons: SeasonsService,
    private readonly rankings: RankingsReader,
    private readonly views: ScrimViews,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  private ref(u: BotUserSource) {
    return botUserRef(u, this.config.webOrigin);
  }

  private webUrl(path: string): string {
    return new URL(path, this.config.webOrigin).toString();
  }

  /** GET /bot/users/lookup (6-3, D224). 탈퇴 회원도 찾는다 */
  async lookup(discordId: string): Promise<GetBotUserLookupResponse> {
    const now = this.clock.now();
    const user = await this.prisma.user.findUnique({ where: { discordId } });
    if (!user) throw new AppError('NOT_FOUND');

    const rows = await this.accounts.loadRows(user.id);
    const { lol, tft } = primaryRiotRows(rows);
    const tiers: BotUserTier[] = [];
    for (const r of [lol, tft]) {
      if (!r || !r.verified || r.code === 'steam') continue;
      const rank = await this.accounts.latestRank(r);
      if (!rank || rank.tier === 'UNRANKED') continue;
      tiers.push({
        game: r.code as TierRankingGame,
        account_name: r.displayName,
        tier: rank.tier,
        division: rank.division,
        lp: rank.lp,
        synced_at: r.lastSyncedAt?.toISOString() ?? null,
      });
    }

    const season = resolveSeasonAt(await this.seasons.all(), now);
    const ratings: BotUserRating[] = [];
    if (season) {
      const rows = await this.prisma.rating.findMany({ where: { userId: user.id, seasonId: season.id } });
      const games = await this.prisma.game.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
      for (const g of games) {
        const code = GameCode.safeParse(g.code);
        const r = rows.find((x) => x.gameId === g.id);
        if (!code.success || !r) continue;
        ratings.push({
          game: code.data,
          elo: r.elo,
          wins: r.wins,
          losses: r.losses,
          rank: await this.rankings.eloRankOf(code.data, season.id, user.id),
        });
      }
    }

    return GetBotUserLookupResponse.parse({
      user: {
        ...this.ref(user),
        role: user.role,
        joined_at: user.createdAt.toISOString(),
        left_at: user.leftAt?.toISOString() ?? null,
      },
      tiers,
      season: season ? seasonRef(season) : null,
      ratings,
    });
  }

  /** GET /bot/scrims/upcoming (6-4, D222). 참가자·사용자·게임은 일괄 조회(N+1 없음) */
  async upcoming(withinMin: number): Promise<GetBotUpcomingScrimsResponse> {
    const now = this.clock.now();
    const until = new Date(now.getTime() + withinMin * 60_000);
    const scrims = await this.prisma.scrim.findMany({
      where: { status: { in: [...OPEN_STATUSES] }, scheduledAt: { gte: now, lt: until } },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: BOT_UPCOMING_LIMIT,
    });
    const ids = scrims.map((s) => s.id);
    const players = ids.length
      ? await this.prisma.scrimPlayer.findMany({
          where: { scrimId: { in: ids }, status: { in: ['joined', 'waitlist'] } },
          select: { scrimId: true, userId: true, status: true },
        })
      : [];
    const userIds = [...new Set([...scrims.map((s) => s.hostId), ...players.filter((p) => p.status === 'joined').map((p) => p.userId)])];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, nickname: true, discordId: true, discordAvatar: true, notifyScrimStart: true, leftAt: true },
        })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));
    const games = ids.length ? await this.views.gamesById() : new Map();

    const items: BotUpcomingScrim[] = scrims.map((s) => {
      const host = userById.get(s.hostId);
      const game = games.get(s.gameId);
      if (!host || !game) throw new AppError('INTERNAL_ERROR', undefined, { message: '곧 시작 내전의 방장·게임 없음' });
      const mine = players.filter((p) => p.scrimId === s.id);
      const joined = mine.filter((p) => p.status === 'joined');
      const notify = new Set<string>();
      for (const p of joined) {
        const u = userById.get(p.userId);
        if (u && u.discordId && isLinkedDiscordId(u.discordId) && u.notifyScrimStart && u.leftAt === null) notify.add(u.discordId);
      }
      return {
        id: s.id,
        title: s.title,
        url: this.webUrl(`/scrims/${encodeURIComponent(s.id)}`),
        game: this.views.gameRef(game),
        status: s.status as BotUpcomingScrim['status'],
        scheduled_at: s.scheduledAt.toISOString(),
        capacity: s.capacity,
        joined_count: joined.length,
        waitlist_count: mine.length - joined.length,
        host: this.ref(host),
        notify_discord_ids: [...notify].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      };
    });
    return GetBotUpcomingScrimsResponse.parse({ items, next_cursor: null, generated_at: now.toISOString() });
  }

  /** GET /bot/rankings/:type (6-5). 웹과 같은 캐시 행의 앞 limit명 */
  async ranking(req: BotRankingRequest): Promise<GetBotRankingResponse> {
    const unit = BOT_RANKING_UNIT_BY_TYPE[req.type];
    let context: GetBotRankingResponse['context'] = { ...EMPTY_CONTEXT };
    let rows: Row[] = [];
    let syncedAt: Date | null = null;
    let stale = false;
    let webPath: string;
    let limit: number;

    switch (req.type) {
      case 'tier': {
        const { game } = req.query;
        limit = req.query.limit;
        const view = await this.rankings.tierView(game);
        rows = view.entries.map((e) => ({ rank: e.rank, user: e.user, value: e.score, detail: tierDetail(e), rank_change: e.rank_change }));
        syncedAt = view.syncedAt;
        stale = view.stale;
        context = { ...context, game };
        webPath = `/rankings?tab=tier&game=${game}`;
        break;
      }
      case 'elo': {
        const { game } = req.query;
        limit = req.query.limit;
        const { season, view } = await this.rankings.eloDefaultView(game);
        if (view) {
          rows = view.entries.map((e) => ({
            rank: e.rank,
            user: e.user,
            value: e.elo,
            detail: `${e.wins}승 ${e.losses}패`,
            rank_change: e.rank_change,
          }));
          syncedAt = view.syncedAt;
          stale = view.stale;
        }
        context = { ...context, game, season: season ? seasonRef(season) : null, is_final: view?.isFinal ?? false };
        webPath = `/rankings?tab=elo&game=${game}`;
        break;
      }
      case 'activity': {
        const period: ActivityPeriod = req.query.period;
        limit = req.query.limit;
        const view = await this.rankings.activityView(period);
        const p = view.payload;
        rows = p.entries.map((e) => ({
          rank: e.rank,
          user: e.user,
          value: e.total_sec,
          detail: activityDetail(p.period_days, e.active_days, e.scrim_count),
          rank_change: e.rank_change,
        }));
        syncedAt = view.syncedAt;
        stale = view.stale;
        context = { ...context, period: p.period, period_start: p.period_start, period_end: p.period_end };
        webPath = `/rankings?tab=activity&period=${period}`;
        break;
      }
      case 'playtime': {
        const appId = req.query.app_id;
        limit = req.query.limit;
        // 보유자 없음도 빈 결과 캐시라 synced_at은 항상 계산 시각이다(D235). app = payload.app({app_id, name: null})
        const { cached } = await this.rankings.playtimeView(appId);
        rows = cached.payload.entries.map((e) => ({
          rank: e.rank,
          user: e.user,
          value: e.minutes_total,
          detail: `최근 2주 ${Math.floor(e.minutes_recent / 60)}시간`,
          rank_change: e.rank_change,
        }));
        syncedAt = cached.syncedAt;
        stale = cached.stale;
        context = { ...context, app: cached.payload.app };
        webPath = `/rankings?tab=playtime&app_id=${appId}`;
        break;
      }
    }

    const picked = rows.slice(0, limit);
    const users = picked.length
      ? await this.prisma.user.findMany({
          where: { id: { in: picked.map((r) => r.user.id) } },
          select: { id: true, nickname: true, discordId: true, discordAvatar: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    const items: BotRankingItem[] = picked.flatMap((r) => {
      const u = byId.get(r.user.id);
      return u ? [{ rank: r.rank, user: this.ref(u), value: r.value, detail: r.detail, rank_change: r.rank_change }] : [];
    });

    return GetBotRankingResponse.parse({
      type: req.type,
      unit,
      context,
      items,
      total: rows.length,
      synced_at: syncedAt?.toISOString() ?? null,
      stale,
      web_url: this.webUrl(webPath),
    });
  }
}

/** 6-5 활동 detail(D239). 내전 0회면 뒷부분을 생략한다 */
export function activityDetail(periodDays: number, activeDays: number, scrimCount: number): string {
  const head = `${periodDays}일 중 ${activeDays}일 활동`;
  return scrimCount > 0 ? `${head} · 내전 ${scrimCount}회` : head;
}
