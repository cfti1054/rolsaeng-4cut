import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  dashboardNewsWindow,
  formatKstMidnight,
  kstWeekWindow,
  latestStartedSeason,
  newsSubtitle,
  nowPlayingItems,
  presenceState,
  resolveSeasonAt,
  seasonDaysLeft,
  seasonProgress,
} from '@gcd/core';
import {
  ACTIVITY_COUNTED_TYPES,
  BALANCE_ELO_WEIGHT_MAX,
  BALANCE_FULL_WEIGHT_GAMES,
  DASHBOARD_NEXT_SCRIM_AVATARS_MAX,
  DASHBOARD_RECENT_RESULTS_LIMIT,
  DASHBOARD_RECRUITING_LIMIT,
  DASHBOARD_TOP_RANKERS_LIMIT,
  BotPresencePlayingStored,
  DASHBOARD_NEWS_EVENT_AHEAD_DAYS,
  DASHBOARD_NEWS_EVENTS_MAX,
  DASHBOARD_NEWS_PATCH_NOTES_MAX,
  DASHBOARD_NEWS_PATCH_RECENT_DAYS,
  DASHBOARD_NEWS_SUBTITLE_MAX,
  type DashboardCommunity,
  type DashboardNews,
  type DashboardMe,
  type DashboardNextScrim,
  type ScrimSummary as ScrimSummaryView,
  type DashboardRecentResult,
  type DashboardTopRankers,
  type DashboardTopRankersState,
  GameCode,
  GetDashboardShellResponse,
  GetDashboardSummaryResponse,
  type DashboardSeason,
  type ScrimRatingStatus,
} from '@gcd/shared';
import { Prisma, type Game, type Scrim, type ScrimResult, type Season } from '@prisma/client';
import { AppError } from '../../common/app-error';
import { fromDbDate, fromDbTime, toDbDate } from '../../common/db-date';
import { APP_CLOCK, type Clock } from '../../common/clock';
import type { AuthUser } from '../../common/decorators/current-user';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { BOT_PRESENCE_SOURCE } from '../bot/bot-presence.service';
import { EVENT_ORDER_BY } from '../news/news.service';
import { rankableUserSql } from '../rankings/rankable-users';
import { RankingsReader } from '../rankings/rankings-reader.service';
import { SeasonsService, seasonRef } from '../ratings/seasons.service';
import { readPlacements } from '../scrims/scrim-result-json';
import { OPEN_STATUSES, ScrimViews, orderSlots } from '../scrims/scrim-views.service';

type CodedGame = Game & { code: GameCode };

/** 현재 시즌 카드 값(요약·사이드바 공통) */
function dashboardSeasonView(current: Season, now: Date): DashboardSeason {
  return {
    ...seasonRef(current),
    days_left: seasonDaysLeft(current.endsAt, now),
    progress: seasonProgress(current, now),
  };
}

/**
 * 홈 요약(계약 S4 8절). 응답 전체를 캐시하지 않고 랭킹 부분만 5분 캐시를 재사용한다(D156).
 * 사용자별 값(next_scrim, recruiting.my_status, me)은 요청마다 읽는다.
 */
@Injectable()
export class DashboardService {
  private readonly log = new Logger(DashboardService.name);

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
    const games = await this.codedGames();

    // 서로 기다릴 필요가 없는 묶음은 함께 보낸다(순서대로 기다리면 DB 왕복이 전부 더해진다).
    // topRankers가 ELO 캐시를 채우므로 그 뒤에 me를 읽는다.
    const [scrims, stats, community, news, recentResults] = await Promise.all([
      this.scrimSection(viewer, now),
      this.stats(now),
      this.community(now),
      this.news(now),
      this.recentResults(),
    ]);
    const ranked = await this.topRankers(games, current ?? latestStartedSeason(seasons, now), now);
    const me = current ? await this.me(viewer.id, games, current, now) : null;

    return GetDashboardSummaryResponse.parse({
      season: current ? dashboardSeasonView(current, now) : null,
      rating_policy: {
        min_games: this.config.ranking.eloMinGames,
        k_base: this.config.rating.kBase,
        k_new: this.config.rating.kNew,
        new_player_games: this.config.rating.newPlayerGames,
        loss_ratio: this.config.rating.lossRatio,
        full_weight_games: BALANCE_FULL_WEIGHT_GAMES,
        elo_weight_max: BALANCE_ELO_WEIGHT_MAX,
      },
      next_scrim: scrims.nextScrim,
      recruiting: scrims.recruiting,
      stats,
      community,
      news,
      ...ranked,
      recent_results: recentResults,
      me,
    });
  }

  /** 다음 내전 카드와 모집 중 목록. 두 번째 것은 다음 내전을 뺀 나머지다. */
  private async scrimSection(
    viewer: AuthUser,
    now: Date,
  ): Promise<{ nextScrim: DashboardNextScrim | null; recruiting: ScrimSummaryView[] }> {
    const next = await this.nextScrimRow(viewer.id, now);
    const recruitingRows = await this.prisma.scrim.findMany({
      where: { status: { in: [...OPEN_STATUSES] }, ...(next ? { id: { not: next.scrim.id } } : {}) },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: DASHBOARD_RECRUITING_LIMIT,
    });
    const summaries = await this.views.summaries(next ? [next.scrim, ...recruitingRows] : recruitingRows, viewer, now);
    const nextScrim: DashboardNextScrim | null =
      next && summaries[0]
        ? { source: next.source, scrim: summaries[0], participants: await this.participants(next.scrim) }
        : null;
    return { nextScrim, recruiting: next ? summaries.slice(1) : summaries };
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

  /**
   * S5 8절 봇 자료 블록. 요청마다 읽는다(접속 현황 1행 + 봇 자료 존재 + 활동 멤버 수, 최대 3쿼리).
   * 실패는 요약 전체 500이다(부분 실패 규칙은 top_rankers에만 있다).
   */
  private async community(now: Date): Promise<DashboardCommunity> {
    const presence = await this.prisma.botPresence.findUnique({ where: { source: BOT_PRESENCE_SOURCE } });
    const state = presenceState({ capturedAt: presence?.capturedAt ?? null, now });
    const voice: DashboardCommunity['voice'] =
      !presence || state === 'not_connected'
        ? { state: 'not_connected', member_count: null, captured_at: null }
        : state === 'live'
          ? { state: 'live', member_count: presence.voiceMemberCount, captured_at: presence.capturedAt.toISOString() }
          : { state: 'stale', member_count: null, captured_at: presence.capturedAt.toISOString() };

    const botConnected = presence !== null || (await this.prisma.activityLog.findFirst({ select: { id: true } })) !== null;
    let activeMembers: DashboardCommunity['active_members'] = { state: 'not_connected', count: null };
    if (botConnected) {
      const week = kstWeekWindow(now);
      // 활동 = voice·chat만(D240). play는 저장만 하고 세지 않는다. 봇 연결 여부(botConnected)는 type과 무관하다
      const counted = Prisma.join([...ACTIVITY_COUNTED_TYPES]);
      const rows = await this.prisma.$queryRaw<{ count: unknown }[]>`
        /* gcd:active-members */
        SELECT COUNT(DISTINCT al.user_id)::int AS count
        FROM activity_logs al
        JOIN users u ON u.id = al.user_id AND ${rankableUserSql}
        WHERE al.started_at >= ${week.start} AND al.started_at < ${week.end}
          AND al.type::text IN (${counted})`;
      activeMembers = { state: 'ready', count: Number(rows[0]?.count ?? 0) };
    }

    let nowPlaying: DashboardCommunity['now_playing'] = null;
    if (presence && state === 'live') {
      const parsed = BotPresencePlayingStored.safeParse(presence.playing);
      if (!parsed.success) this.log.warn('bot_presence.playing 형식 불일치, [] 로 취급');
      const playing = parsed.success ? parsed.data : [];
      if (playing.length > 0) {
        nowPlaying = { captured_at: presence.capturedAt.toISOString(), items: nowPlayingItems(playing) };
      }
    }
    return { voice, active_members: activeMembers, now_playing: nowPlaying };
  }

  /**
   * S6 8-3 홈 「패치 · 이벤트」 + 최신 공지(D258). 요청마다 쿼리 3개(공지 1, 패치노트 1, 이벤트 1) + 게임 참조. 캐시 없음.
   * 실패는 요약 전체 500(부분 실패 규칙은 top_rankers에만 있다, D196).
   */
  private async news(now: Date): Promise<DashboardNews> {
    const w = dashboardNewsWindow(now, DASHBOARD_NEWS_PATCH_RECENT_DAYS, DASHBOARD_NEWS_EVENT_AHEAD_DAYS);
    const [notice, patches, events] = await Promise.all([
      this.prisma.notice.findFirst({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      this.prisma.patchNote.findMany({
        where: { publishedOn: { gte: toDbDate(w.patchSince) } },
        orderBy: [{ publishedOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: DASHBOARD_NEWS_PATCH_NOTES_MAX,
      }),
      this.prisma.calendarEvent.findMany({
        where: { endsOn: { gte: toDbDate(w.today) }, startsOn: { lte: toDbDate(w.eventUntil) } },
        orderBy: EVENT_ORDER_BY,
        take: DASHBOARD_NEWS_EVENTS_MAX,
      }),
    ]);
    const games = patches.length + events.length > 0 ? await this.views.gamesById() : new Map<string, Game>();
    const gameRef = (id: string) => {
      const g = games.get(id);
      if (!g) throw new AppError('INTERNAL_ERROR', undefined, { message: '소식 게임 없음' });
      return this.views.gameRef(g);
    };
    return {
      notice: notice ? { id: notice.id, title: notice.title, created_at: notice.createdAt.toISOString() } : null,
      items: [
        ...patches.map((p) => ({
          kind: 'patch_note' as const,
          id: p.id,
          game: gameRef(p.gameId),
          title: p.title,
          subtitle: newsSubtitle(p.summary, DASHBOARD_NEWS_SUBTITLE_MAX),
          date: fromDbDate(p.publishedOn),
          url: p.url,
        })),
        ...events.map((e) => ({
          kind: 'event' as const,
          id: e.id,
          game: e.gameId === null ? null : gameRef(e.gameId),
          title: e.title,
          subtitle: newsSubtitle(e.description, DASHBOARD_NEWS_SUBTITLE_MAX),
          date: fromDbDate(e.startsOn),
          ends_on: fromDbDate(e.endsOn),
          start_time: fromDbTime(e.startTime),
          end_time: fromDbTime(e.endTime),
          url: e.url,
        })),
      ],
    };
  }

  /**
   * 8-2·21절. 게임을 sort_order 순으로 읽어 처음 행이 있는 게임, 전부 비면 첫 게임.
   * 시즌 없음은 no_season. games 없음·eloView 실패는 unavailable(요약 500으로 올리지 않음, D196·D198).
   */
  private async topRankers(
    games: readonly CodedGame[],
    season: Season | null,
    now: Date,
  ): Promise<{ top_rankers: DashboardTopRankers | null; top_rankers_state: DashboardTopRankersState }> {
    if (!season) return { top_rankers: null, top_rankers_state: 'no_season' };
    if (games.length === 0) {
      this.log.error('games 시드 없음: 요약 top_rankers unavailable');
      return { top_rankers: null, top_rankers_state: 'unavailable' };
    }
    let picked: DashboardTopRankers | null = null;
    for (const game of games) {
      try {
        const view = await this.rankings.eloView(game, season, now);
        const block: DashboardTopRankers = {
          game: game.code,
          season: seasonRef(season),
          is_final: view.isFinal,
          items: view.entries.slice(0, DASHBOARD_TOP_RANKERS_LIMIT),
          synced_at: view.syncedAt?.toISOString() ?? null,
          stale: view.stale,
        };
        if (block.items.length > 0) return { top_rankers: block, top_rankers_state: 'ready' };
        picked ??= block;
      } catch (err) {
        this.log.error(
          `요약 top_rankers 계산 실패 game=${game.code} season=${season.id}: ${err instanceof Error ? err.message : 'unknown'}`,
        );
        return { top_rankers: null, top_rankers_state: 'unavailable' };
      }
    }
    if (!picked) {
      this.log.error(`요약 top_rankers 블록 없음 season=${season.id}`);
      return { top_rankers: null, top_rankers_state: 'unavailable' };
    }
    return { top_rankers: picked, top_rankers_state: 'ready' };
  }

  /** 8-2 사이드바 값. 대표 게임 = 현재 시즌 경기 수 최다(같으면 sort_order, D157). elo·rank는 같은 캐시 행 */
  private async me(userId: string, games: readonly CodedGame[], season: Season, now: Date): Promise<DashboardMe | null> {
    const ratings = await this.prisma.rating.findMany({ where: { userId, seasonId: season.id } });
    let best: { game: CodedGame; elo: number; played: number } | null = null;
    for (const game of games) {
      const r = ratings.find((x) => x.gameId === game.id);
      if (!r) continue;
      const played = r.wins + r.losses;
      if (!best || played > best.played) best = { game, elo: r.elo, played };
    }
    if (!best) return null;
    // 캐시가 아직 없으면 계산해서 채운다(없으면 사이드바 순위가 빠진다). 계산 실패는 순위 없이 ELO만 보인다(21절)
    let entry: { elo: number; rank: number } | null = null;
    try {
      const view = await this.rankings.eloView(best.game, season, now);
      entry = view.entries.find((e) => e.user.id === userId) ?? null;
    } catch (err) {
      this.log.warn(`me 순위 계산 실패: ${err instanceof Error ? err.name : 'error'}`);
    }
    return { game: best.game.code, elo: entry?.elo ?? best.elo, rank: entry?.rank ?? null, games: best.played };
  }

  private async codedGames(): Promise<CodedGame[]> {
    const rows = await this.prisma.game.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    return rows.filter((g): g is CodedGame => GameCode.safeParse(g.code).success);
  }

  /**
   * GET /dashboard/shell (사이드바용). season·me는 요약과 같은 규칙이다.
   * 통계·커뮤니티·뉴스·랭커·최근 결과·다음 내전은 계산하지 않는다.
   */
  async shell(viewer: AuthUser): Promise<GetDashboardShellResponse> {
    const now = this.clock.now();
    const seasons = await this.seasons.all();
    const current = resolveSeasonAt(seasons, now);
    const games = await this.codedGames();
    return GetDashboardShellResponse.parse({
      season: current ? dashboardSeasonView(current, now) : null,
      me: current ? await this.me(viewer.id, games, current, now) : null,
    });
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
            winner_team: r.winnerTeam,
            winner: r.winnerTeam || !winner || !users.has(winner) ? null : this.views.userRef(users, winner),
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
