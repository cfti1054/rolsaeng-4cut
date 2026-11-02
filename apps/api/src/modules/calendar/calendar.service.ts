import { Inject, Injectable } from '@nestjs/common';
import { calendarMonthRange, kstDateKey, mergeUpcomingItems, resolveCalendarMonth, upcomingWindow } from '@gcd/core';
import {
  ADMIN_UPCOMING_DAYS,
  ADMIN_UPCOMING_MAX,
  type AdminUpcoming,
  CALENDAR_EVENTS_MAX,
  CALENDAR_SCRIMS_MAX,
  type CalendarEventItem,
  type CalendarScrimItem,
  type CalendarScrimStatus,
  type GetCalendarQuery,
  GetCalendarResponse,
  type ScrimSummary,
} from '@gcd/shared';
import type { CalendarEvent } from '@prisma/client';
import { APP_CLOCK, type Clock } from '../../common/clock';
import { toDbDate } from '../../common/db-date';
import type { AuthUser } from '../../common/decorators/current-user';
import { PrismaService } from '../../prisma/prisma.service';
import { EVENT_ORDER_BY, NewsService } from '../news/news.service';
import { ScrimViews } from '../scrims/scrim-views.service';

/** 캘린더·「다가오는 일정」에 나오는 내전 상태(취소 제외, D287) */
const CALENDAR_SCRIM_STATUSES: CalendarScrimStatus[] = ['recruiting', 'full', 'playing', 'finished'];

/**
 * 내전 카드 → 캘린더 항목. 공개 필드만 투영(방장·1위·명단 없음, D287). 값은 같은 요청자의 GET /scrims 카드와 같다.
 * GET /calendar와 「다가오는 일정」(AdminOverview.upcoming)이 함께 쓴다(23-8-4).
 */
export function toCalendarScrimItem(s: ScrimSummary): CalendarScrimItem {
  return {
    kind: 'scrim',
    id: s.id,
    title: s.title,
    game: s.game,
    steam_app: s.steam_app,
    custom_game_name: s.custom_game_name,
    date: kstDateKey(new Date(s.scheduled_at)),
    scheduled_at: s.scheduled_at,
    status: s.status as CalendarScrimStatus,
    capacity: s.capacity,
    joined_count: s.joined_count,
    join_closed: s.join_closed,
    my_status: s.my_status,
    result_status: s.result_status,
  };
}

/**
 * GET /calendar(계약 S6 23-3)와 「다가오는 일정」(23-8-4). 읽기 전용, 트랜잭션·캐시 없음(D295·D277) — 일정·내전 두 목록의 순간 불일치는 허용한다.
 * 계산은 core(resolveCalendarMonth·calendarMonthRange·kstDateKey·upcomingWindow·mergeUpcomingItems),
 * 직렬화는 NewsService.eventViews·ScrimViews.summaries. 일정 정렬은 EVENT_ORDER_BY(D302).
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly views: ScrimViews,
    private readonly news: NewsService,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  private async eventItems(rows: CalendarEvent[]): Promise<CalendarEventItem[]> {
    return (await this.news.eventViews(rows)).map((v) => ({ kind: 'event', ...v }));
  }

  async get(viewer: AuthUser, q: GetCalendarQuery): Promise<GetCalendarResponse> {
    const now = this.clock.now();
    const month = resolveCalendarMonth(q.month, now);
    const r = calendarMonthRange(month);
    const base = { month, from: r.from, to: r.to };

    let gameId: string | undefined;
    if (q.game) {
      const g = await this.prisma.game.findUnique({ where: { code: q.game } });
      if (!g) return GetCalendarResponse.parse({ ...base, items: [], truncated: { scrims: false, events: false } });
      gameId = g.id;
    }
    const byGame = gameId ? { gameId } : {};

    // 일정: 격자 구간과 겹치는 것(starts_on ≤ to && ends_on ≥ from). game 필터면 game null 일정은 빠진다(D288)
    const eventRows = await this.prisma.calendarEvent.findMany({
      where: { startsOn: { lte: toDbDate(r.to) }, endsOn: { gte: toDbDate(r.from) }, ...byGame },
      orderBy: EVENT_ORDER_BY,
      take: CALENDAR_EVENTS_MAX + 1,
    });
    const events = await this.eventItems(eventRows.slice(0, CALENDAR_EVENTS_MAX));

    // 내전: scheduled_at ∈ [fromAt, toBefore)(KST 자정 경계), 취소 제외
    const scrimRows = await this.prisma.scrim.findMany({
      where: { status: { in: CALENDAR_SCRIM_STATUSES }, scheduledAt: { gte: r.fromAt, lt: r.toBefore }, ...byGame },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: CALENDAR_SCRIMS_MAX + 1,
    });
    const summaries = await this.views.summaries(scrimRows.slice(0, CALENDAR_SCRIMS_MAX), viewer, now);
    const scrims = summaries.map(toCalendarScrimItem);

    return GetCalendarResponse.parse({
      ...base,
      items: [...events, ...scrims],
      truncated: { scrims: scrimRows.length > CALENDAR_SCRIMS_MAX, events: eventRows.length > CALENDAR_EVENTS_MAX },
    });
  }

  /**
   * 「다가오는 일정」(23-8-4, D306–D308). 오늘(KST) ~ +ADMIN_UPCOMING_DAYS일, 게임 필터 없음.
   * 일정 = 구간과 겹치는 것(진행 중 포함), 내전 = 취소 제외 && scheduled_at ∈ [now, scrimBefore)(이미 시작한 내전 제외).
   * 각 MAX + 1개를 읽어 core mergeUpcomingItems로 시작 순 병합(같은 순간이면 일정 먼저), has_more = 더 있음.
   * 응답 parse는 호출하는 AdminOverviewService가 GetAdminOverviewResponse로 한다.
   */
  async upcoming(viewer: AuthUser, now: Date): Promise<AdminUpcoming> {
    const w = upcomingWindow(now, ADMIN_UPCOMING_DAYS);
    const [eventRows, scrimRows] = await Promise.all([
      this.prisma.calendarEvent.findMany({
        where: { endsOn: { gte: toDbDate(w.from) }, startsOn: { lte: toDbDate(w.to) } },
        orderBy: EVENT_ORDER_BY,
        take: ADMIN_UPCOMING_MAX + 1,
      }),
      this.prisma.scrim.findMany({
        where: { status: { in: CALENDAR_SCRIM_STATUSES }, scheduledAt: { gte: now, lt: w.scrimBefore } },
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        take: ADMIN_UPCOMING_MAX + 1,
      }),
    ]);
    const events = await this.eventItems(eventRows);
    const scrims = (await this.views.summaries(scrimRows, viewer, now)).map(toCalendarScrimItem);
    const { items, hasMore } = mergeUpcomingItems(events, scrims, ADMIN_UPCOMING_MAX);
    return { from: w.from, to: w.to, items, has_more: hasMore };
  }
}
