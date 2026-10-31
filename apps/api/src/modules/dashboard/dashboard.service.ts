import { Inject, Injectable } from '@nestjs/common';
import {
  formatKstMidnight,
  kstWeekWindow,
  latestStartedSeason,
  resolveSeasonAt,
  seasonDaysLeft,
  seasonProgress,
} from '@gcd/core';
import {
  DASHBOARD_NEXT_SCRIM_AVATARS_MAX,
  DASHBOARD_RECENT_RESULTS_LIMIT,
  DASHBOARD_RECRUITING_LIMIT,
  DASHBOARD_TOP_RANKERS_LIMIT,
  type DashboardMe,
  type DashboardNextScrim,
  type DashboardRecentResult,
  type DashboardTopRankers,
  GameCode,
  GetDashboardSummaryResponse,
  type ScrimRatingStatus,
} from '@gcd/shared';
import type { Game, Scrim, ScrimResult, Season } from '@prisma/client';
import { AppError } from '../../common/app-error';
import { APP_CLOCK, type Clock } from '../../common/clock';
import type { AuthUser } from '../../common/decorators/current-user';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { RankingsReader } from '../rankings/rankings-reader.service';
import { SeasonsService, seasonRef } from '../ratings/seasons.service';
import { readPlacements } from '../scrims/scrim-result-json';
import { OPEN_STATUSES, ScrimViews, orderSlots } from '../scrims/scrim-views.service';

type CodedGame = Game & { code: GameCode };

/**
 * 홈 요약(계약 S4 8절). 응답 전체를 캐시하지 않고 랭킹 부분만 5분 캐시를 재사용한다(D156).
 * 사용자별 값(next_scrim, recruiting.my_status, me)은 요청마다 읽는다.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seasons: SeasonsService,
    private readonly views: ScrimViews,
    private readonly rankings: RankingsReader,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  async summary(viewer: AuthUser): Promise<GetDashboardSummaryResponse> {
    const now = this.clock.now();
    const seasons = await this.seasons.all();
    const current = resolveSeasonAt(seasons, now);
    const rows = await this.prisma.game.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    const games = rows.filter((g): g is CodedGame => GameCode.safeParse(g.code).success);

    const next = await this.nextScrimRow(viewer.id, now);
    const recruitingRows = await this.prisma.scrim.findMany({
      where: { status: { in: [...OPEN_STATUSES] }, ...(next ? { id: { not: next.scrim.id } } : {}) },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: DASHBOARD_RECRUITING_LIMIT,
    });
    const summaries = await this.views.summaries(next ? [next.scrim, ...recruitingRows] : recruitingRows, viewer.id, now);
    const nextScrim: DashboardNextScrim | null =
      next && summaries[0]
        ? { source: next.source, scrim: summaries[0], participants: await this.participants(next.scrim) }
        : null;

    return GetDashboardSummaryResponse.parse({
      season: current
        ? {
            ...seasonRef(current),
            days_left: seasonDaysLeft(current.endsAt, now),
            progress: seasonProgress(current, now),
          }
        : null,
      rating_policy: {
        soft_reset_ratio: this.config.seasonSoftResetRatio,
        min_games: this.config.ranking.eloMinGames,
        k_base: this.config.rating.kBase,
        k_new: this.config.rating.kNew,
        new_player_games: this.config.rating.newPlayerGames,
        loss_ratio: this.config.rating.lossRatio,
      },
      next_scrim: nextScrim,
      recruiting: next ? summaries.slice(1) : summaries,
      stats: await this.stats(now),
      top_rankers: await this.topRankers(games, current ?? latestStartedSeason(seasons, now), now),
      recent_results: await this.recentResults(),
      me: current ? await this.me(viewer.id, games, current) : null,
    });
  }

  /** 8-1 다음 내전(카드에 쓸 내전 행과 출처). 대기·playing은 대상이 아니다(D158) */
  private async nextScrimRow(userId: string, now: Date): Promise<{ source: DashboardNextScrim['source']; scrim: Scrim } | null> {
    const order = [{ scheduledAt: 'asc' as const }, { id: 'asc' as const }];
    const mine = await this.prisma.scrimPlayer.findMany({ where: { userId, status: 'joined' }, select: { scrimId: true } });
    if (mine.length > 0) {
      const joined = await this.prisma.scrim.findFirst({
        where: { id: { in: mine.map((p) => p.scrimId) }, status: { in: [...OPEN_STATUSES] } },
        orderBy: order,
      });
      if (joined) return { source: 'joined', scrim: joined };
    }
    const open = await this.prisma.scrim.findFirst({
      where: { status: 'recruiting', scheduledAt: { gt: now } },
      orderBy: order,
    });
    return open ? { source: 'recruiting', scrim: open } : null;
  }

  /** joined 참가자 슬롯 순서 앞 6명 */
  private async participants(scrim: Scrim): Promise<DashboardNextScrim['participants']> {
    const players = await this.prisma.scrimPlayer.findMany({ where: { scrimId: scrim.id, status: 'joined' } });
    const picked = orderSlots(players, scrim.hostId).slice(0, DASHBOARD_NEXT_SCRIM_AVATARS_MAX);
    const users = await this.views.usersById(picked.map((p) => p.userId));
    return picked.map((p) => this.views.userRef(users, p.userId));
  }

  private async stats(now: Date) {
    const week = kstWeekWindow(now);
    const [recruiting, thisWeek] = await Promise.all([
      this.prisma.scrim.count({ where: { status: { in: [...OPEN_STATUSES] } } }),
      this.prisma.scrim.count({
        where: { status: { not: 'cancelled' }, scheduledAt: { gte: week.start, lt: week.end } },
      }),
    ]);
    return { recruiting_scrims: recruiting, scrims_this_week: thisWeek, week_start: formatKstMidnight(week.start) };
  }

  /** 8-2. 게임을 sort_order 순으로 읽어 처음 행이 있는 게임, 전부 비면 첫 게임 */
  private async topRankers(games: readonly CodedGame[], season: Season | null, now: Date): Promise<DashboardTopRankers | null> {
    if (!season) return null;
    let picked: DashboardTopRankers | null = null;
    for (const game of games) {
      const view = await this.rankings.eloView(game, season, now);
      const block: DashboardTopRankers = {
        game: game.code,
        season: seasonRef(season),
        is_final: view.isFinal,
        items: view.entries.slice(0, DASHBOARD_TOP_RANKERS_LIMIT),
        synced_at: view.syncedAt?.toISOString() ?? null,
        stale: view.stale,
      };
      if (block.items.length > 0) return block;
      picked ??= block;
    }
    return picked;
  }

  /** 8-2 사이드바 값. 대표 게임 = 현재 시즌 경기 수 최다(같으면 sort_order, D157). elo·rank는 같은 캐시 행 */
  private async me(userId: string, games: readonly CodedGame[], season: Season): Promise<DashboardMe | null> {
    const ratings = await this.prisma.rating.findMany({ where: { userId, seasonId: season.id } });
    let best: { game: CodedGame; elo: number; played: number } | null = null;
    for (const game of games) {
      const r = ratings.find((x) => x.gameId === game.id);
      if (!r) continue;
      const played = r.wins + r.losses;
      if (!best || played > best.played) best = { game, elo: r.elo, played };
    }
    if (!best) return null;
    const entry = await this.rankings.eloEntryOf(best.game.code, season.id, userId);
    return { game: best.game.code, elo: entry?.elo ?? best.elo, rank: entry?.rank ?? null, games: best.played };
  }

  /** 8-3. 내전·게임·사용자·이력을 id 목록으로 한 번씩 읽는다(N+1 없음) */
  private async recentResults(): Promise<DashboardRecentResult[]> {
    const limit = DASHBOARD_RECENT_RESULTS_LIMIT;
    const [approved, pending] = await Promise.all([
      this.prisma.scrimResult.findMany({
        where: { status: 'approved' },
        orderBy: [{ approvedAt: 'desc' }, { id: 'asc' }],
        take: limit,
      }),
      this.prisma.scrimResult.findMany({
        where: { status: 'pending' },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: limit,
      }),
    ]);
    const merged = [...approved, ...pending]
      .map((r) => ({ r, at: this.resultAt(r) }))
      .sort((a, b) => {
        const d = b.at.getTime() - a.at.getTime();
        if (d !== 0) return d;
        return a.r.scrimId < b.r.scrimId ? -1 : a.r.scrimId > b.r.scrimId ? 1 : 0;
      })
      .slice(0, limit);
    if (merged.length === 0) return [];

    const scrimIds = merged.map((m) => m.r.scrimId);
    const scrims = await this.prisma.scrim.findMany({ where: { id: { in: scrimIds } } });
    const history = await this.prisma.ratingHistory.findMany({ where: { scrimId: { in: scrimIds } } });
    const games = await this.views.gamesById();
    const winnerIds = merged.flatMap((m) => {
      const w = this.placementWinner(m.r);
      return w ? [w] : [];
    });
    const users = await this.views.usersById(winnerIds);
    const scrimById = new Map(scrims.map((s) => [s.id, s]));

    return merged.flatMap(({ r, at }) => {
      const scrim = scrimById.get(r.scrimId);
      const game = scrim ? games.get(scrim.gameId) : undefined;
      if (!scrim || !game) throw new AppError('INTERNAL_ERROR', undefined, { message: '최근 결과의 내전·게임 없음' });
      const rows = history.filter((h) => h.scrimId === r.scrimId);
      const ratingStatus: ScrimRatingStatus = !scrim.rated
        ? 'not_rated'
        : r.status === 'approved'
          ? rows.length > 0
            ? 'applied'
            : 'skipped'
          : 'waiting';
      const winner = this.placementWinner(r);
      return [
        {
          scrim_id: scrim.id,
          title: scrim.title,
          game: this.views.gameRef(game),
          at: at.toISOString(),
          result_status: r.status as DashboardRecentResult['result_status'],
          outcome: {
            winner_team: game.hasTeams ? r.winnerTeam : null,
            winner: !game.hasTeams && winner && users.has(winner) ? this.views.userRef(users, winner) : null,
          },
          rating_status: ratingStatus,
          elo_swing:
            game.hasTeams && ratingStatus === 'applied'
              ? Math.max(...rows.map((h) => Math.abs(h.eloAfter - h.eloBefore)))
              : null,
        },
      ];
    });
  }

  /** approved면 approved_at, pending이면 제출 시각 */
  private resultAt(r: ScrimResult): Date {
    return r.status === 'approved' && r.approvedAt ? r.approvedAt : r.createdAt;
  }

  private placementWinner(r: ScrimResult): string | null {
    return readPlacements(r.placements)?.find((p) => p.placement === 1)?.user_id ?? null;
  }
}
