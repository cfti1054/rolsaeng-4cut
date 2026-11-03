import { Inject, Injectable } from '@nestjs/common';
import { computeScrimRestriction, formatKstMidnight, kstMonthWindow, kstWeekWindow, noShowLookbackStart } from '@gcd/core';
import { GetAdminOverviewResponse } from '@gcd/shared';
import { APP_CLOCK, type Clock } from '../../common/clock';
import type { AuthUser } from '../../common/decorators/current-user';
import { PrismaService } from '../../prisma/prisma.service';
import { CalendarService } from '../calendar/calendar.service';
import { RANKING_CACHE_STORE, type RankingCacheStore } from '../rankings/ranking-cache.store';
import { ScrimRestrictionService } from '../scrims/scrim-restriction.service';
import { marksByUser } from './admin-review.service';

/**
 * S6 GET /admin/overview(계약 S6 12-5, D277). AdminOverview 주석 정의 그대로, 캐시 없음(운영진만 보는 화면).
 * 시각 기준은 KST(주 = 월요일 00:00, 달 = 1일 00:00). 지난달 = kstMonthWindow(month_start − 1ms).
 * upcoming = CalendarService.upcoming(viewer, now)(23-8-4, D306) — my_status는 요청한 운영진 본인.
 */
@Injectable()
export class AdminOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly restriction: ScrimRestrictionService,
    @Inject(RANKING_CACHE_STORE) private readonly cache: RankingCacheStore,
    private readonly calendar: CalendarService,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  async overview(viewer: AuthUser): Promise<GetAdminOverviewResponse> {
    const now = this.clock.now();
    const week = kstWeekWindow(now);
    const month = kstMonthWindow(now);
    const lastMonth = kstMonthWindow(new Date(month.start.getTime() - 1));
    const policy = this.restriction.policy;

    const [total, active, admins, scrimsThisWeek, pendingCount, oldestPending, thisMonth, prevMonth, marks, cache, upcoming] =
      await Promise.all([
        this.prisma.user.count({ where: { deletedAt: null } }),
        this.prisma.user.count({ where: { leftAt: null, deletedAt: null } }),
        this.prisma.user.count({ where: { role: 'admin' } }),
        this.prisma.scrim.count({ where: { status: { not: 'cancelled' }, scheduledAt: { gte: week.start, lt: week.end } } }),
        this.prisma.scrimResult.count({ where: { status: 'pending' } }),
        this.prisma.scrimResult.findFirst({ where: { status: 'pending' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
        this.prisma.scrimPlayer.count({ where: { status: 'no_show', noShowMarkedAt: { gte: month.start, lt: month.end } } }),
        this.prisma.scrimPlayer.count({ where: { status: 'no_show', noShowMarkedAt: { gte: lastMonth.start, lt: lastMonth.end } } }),
        this.prisma.scrimPlayer.findMany({
          where: { status: 'no_show', noShowMarkedAt: { gt: noShowLookbackStart(now, policy) } },
          select: { userId: true, noShowMarkedAt: true },
        }),
        this.cache.summary(),
        this.calendar.upcoming(viewer, now),
      ]);

    let restricted = 0;
    let nextRelease: Date | null = null;
    for (const m of marksByUser(marks).values()) {
      const s = computeScrimRestriction(m, now, policy);
      if (!s.restricted || !s.until) continue;
      restricted++;
      if (nextRelease === null || s.until.getTime() < nextRelease.getTime()) nextRelease = s.until;
    }

    return GetAdminOverviewResponse.parse({
      generated_at: now.toISOString(),
      week_start: formatKstMidnight(week.start),
      month_start: formatKstMidnight(month.start),
      members: { total, active, admins },
      scrims_this_week: scrimsThisWeek,
      pending_results: { count: pendingCount, oldest_submitted_at: oldestPending?.createdAt.toISOString() ?? null },
      no_shows: { this_month: thisMonth, last_month: prevMonth },
      restricted_members: { count: restricted, next_release_at: nextRelease?.toISOString() ?? null },
      ranking_cache: { last_computed_at: cache.lastComputedAt?.toISOString() ?? null, failing_keys: cache.failingKeys },
      upcoming,
    });
  }
}
