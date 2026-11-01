import { Inject, Injectable } from '@nestjs/common';
import {
  computeScrimRestriction,
  noShowLookbackStart,
  previewNoShowRestriction,
  revertBlockReason,
} from '@gcd/core';
import {
  AdminNoShowScrim,
  AdminResultItem,
  type ListAdminNoShowScrimsQuery,
  ListAdminNoShowScrimsResponse,
  type ListAdminResultsQuery,
  ListAdminResultsResponse,
  SCRIM_RESULT_REVERT_WINDOW_DAYS,
  type ScrimRatingStatus,
} from '@gcd/shared';
import type { Prisma, ScrimResult } from '@prisma/client';
import { AppError } from '../../common/app-error';
import { auditQuote, writeAudit } from '../../common/audit';
import { APP_CLOCK, type Clock } from '../../common/clock';
import type { AuthUser } from '../../common/decorators/current-user';
import { cursorDate, cursorId, decodeListCursor, encodeListCursor, pageOf } from '../../common/list-cursor';
import { scrimWriteTx } from '../../common/scrim-tx';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { laterGameUsersByResult } from '../scrims/revert-checks';
import { readPlacements } from '../scrims/scrim-result-json';
import { ScrimRestrictionService } from '../scrims/scrim-restriction.service';
import { ScrimViews, orderSlots } from '../scrims/scrim-views.service';
import { lockOrNotFound } from '../scrims/scrims.service';

const DAY_MS = 86_400_000;

/** 노쇼 표시 시각 목록 → 회원별(조회 1회 결과를 나눈다) */
export function marksByUser(rows: { userId: string; noShowMarkedAt: Date | null }[]): Map<string, Date[]> {
  const out = new Map<string, Date[]>();
  for (const r of rows) {
    if (!(r.noShowMarkedAt instanceof Date)) continue;
    const list = out.get(r.userId) ?? [];
    list.push(r.noShowMarkedAt);
    out.set(r.userId, list);
  }
  return out;
}

/**
 * S6 관리자 결과·노쇼 후보(계약 S6 4-2, 12-6·12-7). 승인·반려·되돌리기·노쇼 표시 자체는 기존 /scrims 경로를 쓴다(D251·D252).
 * 목록은 페이지 단위로 테이블마다 한 번씩 읽는다(N+1 없음).
 */
@Injectable()
export class AdminReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly views: ScrimViews,
    private readonly restriction: ScrimRestrictionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  // ---------------------------------------------------------------------------
  // GET /admin/results
  // ---------------------------------------------------------------------------

  async results(admin: AuthUser, q: ListAdminResultsQuery): Promise<ListAdminResultsResponse> {
    const now = this.clock.now();
    const kind = `results:${q.view}`;
    let rows: ScrimResult[];
    let cursorOf: (r: ScrimResult) => string;
    if (q.view === 'pending') {
      const where: Prisma.ScrimResultWhereInput = { status: 'pending' };
      if (q.cursor !== undefined) {
        const [c, id] = decodeListCursor(q.cursor, kind, 2);
        const at = cursorDate(c);
        where.OR = [{ createdAt: { gt: at } }, { createdAt: at, id: { gt: cursorId(id) } }];
      }
      rows = await this.prisma.scrimResult.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: q.limit + 1 });
      cursorOf = (r) => encodeListCursor(kind, [r.createdAt.toISOString(), r.id]);
    } else {
      // approved
      const since = new Date(now.getTime() - SCRIM_RESULT_REVERT_WINDOW_DAYS * DAY_MS);
      const and: Prisma.ScrimResultWhereInput[] = [{ status: 'approved' }, { approvedAt: { gte: since } }];
      if (q.cursor !== undefined) {
        const [c, id] = decodeListCursor(q.cursor, kind, 2);
        const at = cursorDate(c);
        and.push({ OR: [{ approvedAt: { lt: at } }, { approvedAt: at, id: { lt: cursorId(id) } }] });
      }
      rows = await this.prisma.scrimResult.findMany({
        where: { AND: and },
        orderBy: [{ approvedAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
      });
      cursorOf = (r) => encodeListCursor(kind, [(r.approvedAt ?? r.createdAt).toISOString(), r.id]);
    }
    const page = pageOf(rows, q.limit, cursorOf);
    return ListAdminResultsResponse.parse({ items: await this.resultItems(page.items, admin, now), next_cursor: page.next_cursor });
  }

  /** 큐 행 조립. 내전·사용자·이력·이후 이력·시즌을 각 1회 */
  private async resultItems(results: ScrimResult[], admin: AuthUser, now: Date): Promise<AdminResultItem[]> {
    if (results.length === 0) return [];
    const ids = results.map((r) => r.id);
    const scrims = await this.prisma.scrim.findMany({ where: { id: { in: [...new Set(results.map((r) => r.scrimId))] } } });
    const scrimById = new Map(scrims.map((s) => [s.id, s]));
    const games = await this.views.gamesById();
    const approvedIds = results.filter((r) => r.status === 'approved').map((r) => r.id);
    const history =
      approvedIds.length === 0 ? [] : await this.prisma.ratingHistory.findMany({ where: { scrimResultId: { in: approvedIds } } });
    const later = await laterGameUsersByResult(this.prisma, history);
    const seasonIds = [...new Set(history.map((h) => h.seasonId))];
    const seasons = seasonIds.length === 0 ? [] : await this.prisma.season.findMany({ where: { id: { in: seasonIds } } });
    const closedSeason = new Set(seasons.filter((s) => s.closedAt !== null).map((s) => s.id));
    const winnerOf = (r: ScrimResult) =>
      r.winnerTeam === null ? (readPlacements(r.placements)?.find((p) => p.placement === 1)?.user_id ?? null) : null;
    const users = await this.views.usersById([
      ...scrims.map((s) => s.hostId),
      ...results.flatMap((r) => [r.submittedById, r.approvedById, winnerOf(r)].filter((x): x is string => x !== null)),
    ]);

    return results.map((r) => {
      const scrim = scrimById.get(r.scrimId);
      const game = scrim ? games.get(scrim.gameId) : undefined;
      if (!scrim || !game) throw new AppError('INTERNAL_ERROR', undefined, { message: '큐 결과의 내전·게임 없음' });
      const rows = history.filter((h) => h.scrimResultId === r.id);
      const ratingStatus: ScrimRatingStatus = !scrim.rated
        ? 'not_rated'
        : r.status === 'approved'
          ? rows.length > 0
            ? 'applied'
            : 'skipped'
          : 'waiting';
      let blocked: AdminResultItem['revert_blocked_reason'] = null;
      if (r.status === 'approved' && r.approvedAt) {
        blocked = revertBlockReason({
          approvedAt: r.approvedAt,
          now,
          windowDays: SCRIM_RESULT_REVERT_WINDOW_DAYS,
          submittedById: r.submittedById,
          actorId: admin.id,
          seasonClosed: rows[0] !== undefined && closedSeason.has(rows[0].seasonId),
          laterGameUserIds: later.get(r.id) ?? [],
        });
      }
      const winner = winnerOf(r);
      return {
        result_id: r.id,
        status: r.status,
        scrim: {
          id: scrim.id,
          title: scrim.title,
          game: this.views.gameRef(game),
          scheduled_at: scrim.scheduledAt.toISOString(),
          started_at: scrim.startedAt?.toISOString() ?? null,
          rated: scrim.rated,
          host: this.views.userRef(users, scrim.hostId),
        },
        outcome: {
          winner_team: r.winnerTeam,
          winner: winner && users.has(winner) ? this.views.userRef(users, winner) : null,
        },
        submitted_by: this.views.userRef(users, r.submittedById),
        submitted_at: r.createdAt.toISOString(),
        approved_by: r.approvedById ? this.views.userRef(users, r.approvedById) : null,
        approved_at: r.approvedAt?.toISOString() ?? null,
        rating_status: ratingStatus,
        can_review: r.status === 'pending' && r.submittedById !== admin.id,
        can_revert: r.status === 'approved' && r.approvedAt !== null && blocked === null,
        revert_blocked_reason: blocked,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // GET /admin/no-show/scrims
  // ---------------------------------------------------------------------------

  async noShowScrims(q: ListAdminNoShowScrimsQuery): Promise<ListAdminNoShowScrimsResponse> {
    const now = this.clock.now();
    const markDays = this.config.scrim.noShowMarkWindowDays;
    const policy = this.restriction.policy;
    // isNoShowMarkWindowOpen(now ≤ scheduled_at + days) ⇔ scheduled_at ≥ now − days
    const and: Prisma.ScrimWhereInput[] = [
      { status: { in: ['playing', 'finished'] } },
      { scheduledAt: { gte: new Date(now.getTime() - markDays * DAY_MS) } },
    ];
    if (q.cursor !== undefined) {
      const [c, id] = decodeListCursor(q.cursor, 'no-show-scrims', 2);
      const at = cursorDate(c);
      and.push({ OR: [{ scheduledAt: { lt: at } }, { scheduledAt: at, id: { lt: cursorId(id) } }] });
    }
    const rows = await this.prisma.scrim.findMany({
      where: { AND: and },
      orderBy: [{ scheduledAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const page = pageOf(rows, q.limit, (s) => encodeListCursor('no-show-scrims', [s.scheduledAt.toISOString(), s.id]));
    const scrims = page.items;
    const players =
      scrims.length === 0
        ? []
        : await this.prisma.scrimPlayer.findMany({
            where: { scrimId: { in: scrims.map((s) => s.id) }, status: { in: ['joined', 'no_show'] } },
          });
    const userIds = [...new Set(players.map((p) => p.userId))];
    const marks =
      userIds.length === 0
        ? new Map<string, Date[]>()
        : marksByUser(
            await this.prisma.scrimPlayer.findMany({
              where: { userId: { in: userIds }, status: 'no_show', noShowMarkedAt: { gt: noShowLookbackStart(now, policy) } },
              select: { userId: true, noShowMarkedAt: true },
            }),
          );
    const users = await this.views.usersById(userIds);
    const games = await this.views.gamesById();
    const items = scrims.map((s) => {
      const game = games.get(s.gameId);
      if (!game) throw new AppError('INTERNAL_ERROR', undefined, { message: '내전 게임 없음' });
      const slots = orderSlots(
        players.filter((p) => p.scrimId === s.id),
        s.hostId,
      );
      return AdminNoShowScrim.parse({
        id: s.id,
        title: s.title,
        game: this.views.gameRef(game),
        status: s.status,
        scheduled_at: s.scheduledAt.toISOString(),
        mark_deadline: new Date(s.scheduledAt.getTime() + markDays * DAY_MS).toISOString(),
        players: slots.map((p) => {
          const m = marks.get(p.userId) ?? [];
          const state = computeScrimRestriction(m, now, policy);
          return {
            user: this.views.userRef(users, p.userId),
            status: p.status,
            no_show_count_30d: state.recentCount,
            restricted_until: state.restricted && state.until ? state.until.toISOString() : null,
            restrict_if_marked: p.status === 'joined' && previewNoShowRestriction(m, now, policy).newlyRestricted,
          };
        }),
      });
    });
    return ListAdminNoShowScrimsResponse.parse({
      items,
      next_cursor: page.next_cursor,
      policy: {
        threshold: policy.threshold,
        window_days: policy.windowDays,
        restriction_days: policy.restrictionDays,
        mark_window_days: markDays,
      },
    });
  }
}
