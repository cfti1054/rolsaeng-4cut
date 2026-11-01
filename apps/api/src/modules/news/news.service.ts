import { Inject, Injectable } from '@nestjs/common';
import { resolveEventsRange } from '@gcd/core';
import {
  type CreateEventRequest,
  type CreateNoticeRequest,
  type CreatePatchNoteRequest,
  EventTime,
  EventView,
  IsoDate,
  type GameCode,
  type ListEventsQuery,
  ListEventsResponse,
  type ListNoticesQuery,
  ListNoticesResponse,
  type ListPatchNotesQuery,
  ListPatchNotesResponse,
  NoticeView,
  PatchNoteView,
  type UpdateEventRequest,
  type UpdateNoticeRequest,
  type UpdatePatchNoteRequest,
  eventScheduleIssues,
} from '@gcd/shared';
import { Prisma, type CalendarEvent, type Game, type Notice, type PatchNote } from '@prisma/client';
import { AppError } from '../../common/app-error';
import { auditDiff, auditQuote, writeAudit } from '../../common/audit';
import { APP_CLOCK, type Clock } from '../../common/clock';
import { fromDbDate, fromDbTime, toDbDate, toDbTime } from '../../common/db-date';
import type { AuthUser } from '../../common/decorators/current-user';
import { cursorDate, cursorId, decodeListCursor, encodeListCursor, invalidCursor, pageOf } from '../../common/list-cursor';
import { PrismaService } from '../../prisma/prisma.service';
import { ScrimViews } from '../scrims/scrim-views.service';

type Tx = Prisma.TransactionClient;
type Db = Pick<Tx, 'game'>;

function isNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025';
}

function gameNotFound(): AppError {
  return new AppError('VALIDATION_FAILED', undefined, { details: [{ path: 'game', message: '등록되지 않은 게임' }] });
}

/** 공지·패치노트 notify_discord 변경 규칙(8-1, D257): 전송 뒤에는 지금 값과 다르게 바꿀 수 없다 */
function assertNotifyChangeAllowed(row: { notifyDiscord: boolean; discordNotifiedAt: Date | null }, next: boolean | undefined): void {
  if (next === undefined || next === row.notifyDiscord) return;
  if (row.discordNotifiedAt !== null) throw new AppError('DISCORD_ALREADY_NOTIFIED');
}

const NOTICE_CURSOR = 'notices';
const PATCH_CURSOR = 'patch-notes';
/** S6 후속(D302): 값 [starts_on, start_time | null, ends_on, id]. 옛 'events' 커서(3개 값)는 다른 목록으로 보고 400 */
const EVENT_CURSOR = 'events2';

/**
 * 모든 일정 목록의 정렬(D302): starts_on ASC, start_time ASC NULLS FIRST(종일 먼저), ends_on ASC, id ASC.
 * news(GET /events)·calendar(GET /calendar·upcoming)·dashboard(홈 소식)가 함께 쓴다. core compareEventSchedule과 같은 순서.
 */
export const EVENT_ORDER_BY = [
  { startsOn: 'asc' },
  { startTime: { sort: 'asc', nulls: 'first' } },
  { endsOn: 'asc' },
  { id: 'asc' },
] satisfies Prisma.CalendarEventOrderByWithRelationInput[];

/** 일정 PATCH 조건부 쓰기 시도 횟수(동시 수정으로 0행이면 다시 읽어 검사, QA minor 1) */
const EVENT_UPDATE_ATTEMPTS = 3;

/** 커서 날짜 자리: 형식 + 달력에 있는 날(shared IsoDate, QA minor 2) */
const isCursorDate = (v: unknown): v is string => typeof v === 'string' && IsoDate.safeParse(v).success;

/** 요청 시각 → DB 값(undefined = 그대로, null = 비우기) */
function dbTimeOrKeep(v: string | null | undefined): Date | null | undefined {
  return v === undefined ? undefined : v === null ? null : toDbTime(v);
}

/**
 * S6 공지·패치노트·이벤트(계약 S6 8절). 읽기는 멤버 전원, 쓰기는 운영진(컨트롤러 @Roles).
 * 쓰기는 한 트랜잭션에서 행 + 감사 1행(10절). 날짜 컬럼은 db-date.ts로만 변환한다(D254).
 */
@Injectable()
export class NewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly views: ScrimViews,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  // ---------------------------------------------------------------------------
  // 직렬화
  // ---------------------------------------------------------------------------

  async noticeViews(rows: Notice[]): Promise<NoticeView[]> {
    const users = await this.views.usersById(rows.map((r) => r.authorId));
    return rows.map((r) =>
      NoticeView.parse({
        id: r.id,
        title: r.title,
        body: r.body,
        author: this.views.userRef(users, r.authorId),
        notify_discord: r.notifyDiscord,
        discord_notified_at: r.discordNotifiedAt?.toISOString() ?? null,
        created_at: r.createdAt.toISOString(),
        updated_at: r.updatedAt.toISOString(),
      }),
    );
  }

  private gameOf(games: Map<string, Game>, id: string): Game {
    const g = games.get(id);
    if (!g) throw new AppError('INTERNAL_ERROR', undefined, { message: '패치노트·이벤트 게임 없음' });
    return g;
  }

  async patchNoteViews(rows: PatchNote[]): Promise<PatchNoteView[]> {
    if (rows.length === 0) return [];
    const games = await this.views.gamesById();
    return rows.map((r) =>
      PatchNoteView.parse({
        id: r.id,
        game: this.views.gameRef(this.gameOf(games, r.gameId)),
        version: r.version,
        title: r.title,
        summary: r.summary,
        url: r.url,
        published_on: fromDbDate(r.publishedOn),
        notify_discord: r.notifyDiscord,
        discord_notified_at: r.discordNotifiedAt?.toISOString() ?? null,
        auto_registered: r.autoRegistered,
        created_at: r.createdAt.toISOString(),
        updated_at: r.updatedAt.toISOString(),
      }),
    );
  }

  async eventViews(rows: CalendarEvent[]): Promise<EventView[]> {
    if (rows.length === 0) return [];
    const games = await this.views.gamesById();
    return rows.map((r) =>
      EventView.parse({
        id: r.id,
        game: r.gameId === null ? null : this.views.gameRef(this.gameOf(games, r.gameId)),
        title: r.title,
        description: r.description,
        url: r.url,
        starts_on: fromDbDate(r.startsOn),
        ends_on: fromDbDate(r.endsOn),
        start_time: fromDbTime(r.startTime),
        end_time: fromDbTime(r.endTime),
        created_at: r.createdAt.toISOString(),
        updated_at: r.updatedAt.toISOString(),
      }),
    );
  }

  private async gameIdByCode(db: Db, code: GameCode): Promise<string> {
    const g = await db.game.findFirst({ where: { code } });
    if (!g) throw gameNotFound();
    return g.id;
  }

  /** 읽기 필터용: 행이 없는 게임 코드면 빈 목록(VALIDATION_FAILED가 아니다 — 코드 자체는 shared가 검증했다) */
  private async gameIdForFilter(code: GameCode | undefined): Promise<string | null | undefined> {
    if (code === undefined) return undefined;
    const g = await this.prisma.game.findFirst({ where: { code } });
    return g ? g.id : null;
  }

  // ---------------------------------------------------------------------------
  // 읽기(8-2)
  // ---------------------------------------------------------------------------

  /** GET /notices — created_at DESC, id DESC */
  async listNotices(q: ListNoticesQuery): Promise<ListNoticesResponse> {
    let where: Prisma.NoticeWhereInput = {};
    if (q.cursor !== undefined) {
      const [c, id] = decodeListCursor(q.cursor, NOTICE_CURSOR, 2);
      const at = cursorDate(c);
      where = { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursorId(id) } }] };
    }
    const rows = await this.prisma.notice.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const page = pageOf(rows, q.limit, (r) => encodeListCursor(NOTICE_CURSOR, [r.createdAt.toISOString(), r.id]));
    return ListNoticesResponse.parse({ items: await this.noticeViews(page.items), next_cursor: page.next_cursor });
  }

  /** GET /patch-notes — published_on DESC, created_at DESC, id DESC */
  async listPatchNotes(q: ListPatchNotesQuery): Promise<ListPatchNotesResponse> {
    const gameId = await this.gameIdForFilter(q.game);
    if (gameId === null) return ListPatchNotesResponse.parse({ items: [], next_cursor: null });
    const and: Prisma.PatchNoteWhereInput[] = [];
    if (gameId !== undefined) and.push({ gameId });
    if (q.cursor !== undefined) {
      const [p, c, id] = decodeListCursor(q.cursor, PATCH_CURSOR, 3);
      if (!isCursorDate(p)) throw invalidCursor();
      const pub = toDbDate(p);
      const at = cursorDate(c);
      const rowId = cursorId(id);
      and.push({
        OR: [
          { publishedOn: { lt: pub } },
          { publishedOn: pub, createdAt: { lt: at } },
          { publishedOn: pub, createdAt: at, id: { lt: rowId } },
        ],
      });
    }
    const rows = await this.prisma.patchNote.findMany({
      where: and.length > 0 ? { AND: and } : {},
      orderBy: [{ publishedOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const page = pageOf(rows, q.limit, (r) =>
      encodeListCursor(PATCH_CURSOR, [fromDbDate(r.publishedOn), r.createdAt.toISOString(), r.id]),
    );
    return ListPatchNotesResponse.parse({ items: await this.patchNoteViews(page.items), next_cursor: page.next_cursor });
  }

  /**
   * GET /events — starts_on ≤ to && ends_on ≥ from, EVENT_ORDER_BY(D302). from·to 기본값은 core resolveEventsRange.
   * 커서 [starts_on, start_time | null, ends_on, id](23-8-3): NULL은 맨 앞이라 커서 시각이 null이면 「같은 날 시각 있는 행」이 전부 다음이다.
   */
  async listEvents(q: ListEventsQuery): Promise<ListEventsResponse> {
    const range = resolveEventsRange({ from: q.from, to: q.to }, this.clock.now());
    const gameId = await this.gameIdForFilter(q.game);
    if (gameId === null) return ListEventsResponse.parse({ items: [], next_cursor: null, from: range.from, to: range.to });
    const and: Prisma.CalendarEventWhereInput[] = [
      { startsOn: { lte: toDbDate(range.to) } },
      { endsOn: { gte: toDbDate(range.from) } },
    ];
    if (gameId !== undefined) and.push({ gameId });
    if (q.cursor !== undefined) {
      const [s, t, e, id] = decodeListCursor(q.cursor, EVENT_CURSOR, 4);
      if (!isCursorDate(s) || !isCursorDate(e)) throw invalidCursor();
      // 시각 자리 = null(종일) 또는 HH:mm
      if (t !== null && !EventTime.safeParse(t).success) throw invalidCursor();
      const time = t as string | null;
      const so = toDbDate(s);
      const eo = toDbDate(e);
      const rowId = cursorId(id);
      if (time === null) {
        and.push({
          OR: [
            { startsOn: { gt: so } },
            { startsOn: so, startTime: { not: null } },
            { startsOn: so, startTime: null, endsOn: { gt: eo } },
            { startsOn: so, startTime: null, endsOn: eo, id: { gt: rowId } },
          ],
        });
      } else {
        const to = toDbTime(time);
        and.push({
          OR: [
            { startsOn: { gt: so } },
            { startsOn: so, startTime: { gt: to } },
            { startsOn: so, startTime: to, endsOn: { gt: eo } },
            { startsOn: so, startTime: to, endsOn: eo, id: { gt: rowId } },
          ],
        });
      }
    }
    const rows = await this.prisma.calendarEvent.findMany({
      where: { AND: and },
      orderBy: EVENT_ORDER_BY,
      take: q.limit + 1,
    });
    const page = pageOf(rows, q.limit, (r) =>
      encodeListCursor(EVENT_CURSOR, [fromDbDate(r.startsOn), fromDbTime(r.startTime), fromDbDate(r.endsOn), r.id]),
    );
    return ListEventsResponse.parse({
      items: await this.eventViews(page.items),
      next_cursor: page.next_cursor,
      from: range.from,
      to: range.to,
    });
  }

  // ---------------------------------------------------------------------------
  // 공지 쓰기
  // ---------------------------------------------------------------------------

  private noticeAuditValues(r: Notice) {
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      author_id: r.authorId,
      notify_discord: r.notifyDiscord,
      discord_notified_at: r.discordNotifiedAt,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    };
  }

  async createNotice(admin: AuthUser, body: CreateNoticeRequest): Promise<NoticeView> {
    const now = this.clock.now();
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.notice.create({
        data: { title: body.title, body: body.body, authorId: admin.id, notifyDiscord: body.notify_discord, createdAt: now, updatedAt: now },
      });
      await writeAudit(tx, {
        actorId: admin.id,
        action: 'notice.create',
        targetId: created.id,
        summary: `공지 ${auditQuote(created.title)} 작성`,
        details: { title: created.title, body: created.body, notify_discord: created.notifyDiscord },
        at: now,
      });
      return created;
    });
    const [view] = await this.noticeViews([row]);
    return view as NoticeView;
  }

  async updateNotice(admin: AuthUser, id: string, body: UpdateNoticeRequest): Promise<NoticeView> {
    const now = this.clock.now();
    const row = await this.prisma.$transaction(async (tx) => {
      const cur = await tx.notice.findUnique({ where: { id } });
      if (!cur) throw new AppError('NOT_FOUND');
      assertNotifyChangeAllowed(cur, body.notify_discord);
      const diff = auditDiff(
        { title: cur.title, body: cur.body, notify_discord: cur.notifyDiscord },
        { title: body.title, body: body.body, notify_discord: body.notify_discord },
      );
      if (!diff) return cur;
      const data = { title: body.title, body: body.body, notifyDiscord: body.notify_discord, updatedAt: now };
      if (diff.after.notify_discord !== undefined) {
        // 봇 전송 기록과 경합: 전송 전(discord_notified_at null)일 때만 바꾼다
        const r = await tx.notice.updateMany({ where: { id, discordNotifiedAt: null }, data });
        if (r.count !== 1) throw new AppError('DISCORD_ALREADY_NOTIFIED');
      } else {
        await tx.notice.update({ where: { id }, data });
      }
      await writeAudit(tx, {
        actorId: admin.id,
        action: 'notice.update',
        targetId: id,
        summary: `공지 ${auditQuote(body.title ?? cur.title)} 수정`,
        details: diff,
        at: now,
      });
      const updated = await tx.notice.findUnique({ where: { id } });
      if (!updated) throw new AppError('NOT_FOUND');
      return updated;
    });
    const [view] = await this.noticeViews([row]);
    return view as NoticeView;
  }

  async deleteNotice(admin: AuthUser, id: string): Promise<void> {
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      let deleted: Notice;
      try {
        deleted = await tx.notice.delete({ where: { id } });
      } catch (err) {
        if (isNotFound(err)) throw new AppError('NOT_FOUND', undefined, { cause: err });
        throw err;
      }
      await writeAudit(tx, {
        actorId: admin.id,
        action: 'notice.delete',
        targetId: id,
        summary: `공지 ${auditQuote(deleted.title)} 삭제`,
        details: this.noticeAuditValues(deleted),
        at: now,
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 패치노트 쓰기
  // ---------------------------------------------------------------------------

  private patchAuditValues(r: PatchNote, game: GameCode | string) {
    return {
      id: r.id,
      game,
      version: r.version,
      title: r.title,
      summary: r.summary,
      url: r.url,
      published_on: fromDbDate(r.publishedOn),
      notify_discord: r.notifyDiscord,
      discord_notified_at: r.discordNotifiedAt,
      auto_registered: r.autoRegistered,
      created_by: r.createdById,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    };
  }

  private async gameCodeOf(db: Db, gameId: string): Promise<string> {
    const g = await db.game.findUnique({ where: { id: gameId } });
    return g?.code ?? gameId;
  }

  async createPatchNote(admin: AuthUser, body: CreatePatchNoteRequest): Promise<PatchNoteView> {
    const now = this.clock.now();
    const row = await this.prisma.$transaction(async (tx) => {
      const gameId = await this.gameIdByCode(tx, body.game);
      const created = await tx.patchNote.create({
        data: {
          gameId,
          version: body.version,
          title: body.title,
          summary: body.summary,
          url: body.url,
          publishedOn: toDbDate(body.published_on),
          notifyDiscord: body.notify_discord,
          autoRegistered: false,
          createdById: admin.id,
          createdAt: now,
          updatedAt: now,
        },
      });
      await writeAudit(tx, {
        actorId: admin.id,
        action: 'patch_note.create',
        targetId: created.id,
        summary: `패치노트 ${auditQuote(created.title)} 작성`,
        details: {
          game: body.game,
          version: body.version,
          title: body.title,
          summary: body.summary,
          url: body.url,
          published_on: body.published_on,
          notify_discord: body.notify_discord,
        },
        at: now,
      });
      return created;
    });
    const [view] = await this.patchNoteViews([row]);
    return view as PatchNoteView;
  }

  async updatePatchNote(admin: AuthUser, id: string, body: UpdatePatchNoteRequest): Promise<PatchNoteView> {
    const now = this.clock.now();
    const row = await this.prisma.$transaction(async (tx) => {
      const cur = await tx.patchNote.findUnique({ where: { id } });
      if (!cur) throw new AppError('NOT_FOUND');
      const gameId = body.game === undefined ? undefined : await this.gameIdByCode(tx, body.game);
      assertNotifyChangeAllowed(cur, body.notify_discord);
      const curGame = await this.gameCodeOf(tx, cur.gameId);
      const diff = auditDiff(
        {
          game: curGame,
          version: cur.version,
          title: cur.title,
          summary: cur.summary,
          url: cur.url,
          published_on: fromDbDate(cur.publishedOn),
          notify_discord: cur.notifyDiscord,
        } as Record<string, unknown>,
        {
          game: body.game,
          version: body.version,
          title: body.title,
          summary: body.summary,
          url: body.url,
          published_on: body.published_on,
          notify_discord: body.notify_discord,
        },
      );
      if (!diff) return cur;
      const data: Prisma.PatchNoteUncheckedUpdateManyInput = {
        gameId,
        version: body.version,
        title: body.title,
        summary: body.summary,
        url: body.url,
        publishedOn: body.published_on === undefined ? undefined : toDbDate(body.published_on),
        notifyDiscord: body.notify_discord,
        updatedAt: now,
      };
      if (diff.after.notify_discord !== undefined) {
        const r = await tx.patchNote.updateMany({ where: { id, discordNotifiedAt: null }, data });
        if (r.count !== 1) throw new AppError('DISCORD_ALREADY_NOTIFIED');
      } else {
        await tx.patchNote.update({ where: { id }, data });
      }
      await writeAudit(tx, {
        actorId: admin.id,
        action: 'patch_note.update',
        targetId: id,
        summary: `패치노트 ${auditQuote(body.title ?? cur.title)} 수정`,
        details: diff,
        at: now,
      });
      const updated = await tx.patchNote.findUnique({ where: { id } });
      if (!updated) throw new AppError('NOT_FOUND');
      return updated;
    });
    const [view] = await this.patchNoteViews([row]);
    return view as PatchNoteView;
  }

  async deletePatchNote(admin: AuthUser, id: string): Promise<void> {
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      let deleted: PatchNote;
      try {
        deleted = await tx.patchNote.delete({ where: { id } });
      } catch (err) {
        if (isNotFound(err)) throw new AppError('NOT_FOUND', undefined, { cause: err });
        throw err;
      }
      await writeAudit(tx, {
        actorId: admin.id,
        action: 'patch_note.delete',
        targetId: id,
        summary: `패치노트 ${auditQuote(deleted.title)} 삭제`,
        details: this.patchAuditValues(deleted, await this.gameCodeOf(tx, deleted.gameId)),
        at: now,
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 이벤트 쓰기
  // ---------------------------------------------------------------------------

  async createEvent(admin: AuthUser, body: CreateEventRequest): Promise<EventView> {
    const now = this.clock.now();
    const row = await this.prisma.$transaction(async (tx) => {
      const gameId = body.game === null ? null : await this.gameIdByCode(tx, body.game);
      const created = await tx.calendarEvent.create({
        data: {
          gameId,
          title: body.title,
          description: body.description,
          url: body.url,
          startsOn: toDbDate(body.starts_on),
          endsOn: toDbDate(body.ends_on),
          startTime: body.start_time === null ? null : toDbTime(body.start_time),
          endTime: body.end_time === null ? null : toDbTime(body.end_time),
          createdById: admin.id,
          createdAt: now,
          updatedAt: now,
        },
      });
      await writeAudit(tx, {
        actorId: admin.id,
        action: 'event.create',
        targetId: created.id,
        summary: `이벤트 ${auditQuote(created.title)} 등록`,
        details: {
          game: body.game,
          title: body.title,
          description: body.description,
          url: body.url,
          starts_on: body.starts_on,
          ends_on: body.ends_on,
          start_time: body.start_time,
          end_time: body.end_time,
        },
        at: now,
      });
      return created;
    });
    const [view] = await this.eventViews([row]);
    return view as EventView;
  }

  /**
   * PATCH /admin/events/{id}. 저장값과 합친 { starts_on, ends_on, start_time, end_time }을 eventScheduleIssues로 검사한다(8-1, D300).
   * 동시 PATCH 경합(QA s6 일정 시각 minor 1): 읽은 일정 4개 값을 조건으로 건 조건부 updateMany로 쓴다. 그 사이 다른 운영진이
   * 일정 값을 바꿨으면 0행 → 다시 읽어 합친 값부터 다시 검사한다(READ COMMITTED: 같은 트랜잭션의 다음 문은 커밋된 새 값을 본다).
   * 공지·패치노트 PATCH의 조건부 updateMany(discord_notified_at null) 관례와 같은 방식. 재시도는 EVENT_UPDATE_ATTEMPTS번까지.
   */
  async updateEvent(admin: AuthUser, id: string, body: UpdateEventRequest): Promise<EventView> {
    const now = this.clock.now();
    const row = await this.prisma.$transaction(async (tx) => {
      for (let attempt = 1; ; attempt++) {
        const cur = await tx.calendarEvent.findUnique({ where: { id } });
        if (!cur) throw new AppError('NOT_FOUND');
        // 저장값과 합친 기간·시각 검사. 요청 안에서 판단되는 것은 zod가 이미 검사했다
        const issues = eventScheduleIssues({
          starts_on: body.starts_on ?? fromDbDate(cur.startsOn),
          ends_on: body.ends_on ?? fromDbDate(cur.endsOn),
          start_time: body.start_time !== undefined ? body.start_time : fromDbTime(cur.startTime),
          end_time: body.end_time !== undefined ? body.end_time : fromDbTime(cur.endTime),
        });
        if (issues.length > 0) {
          throw new AppError('VALIDATION_FAILED', undefined, { details: issues.map(({ path, message }) => ({ path, message })) });
        }
        const gameId =
          body.game === undefined ? undefined : body.game === null ? null : await this.gameIdByCode(tx, body.game);
        const curGame = cur.gameId === null ? null : await this.gameCodeOf(tx, cur.gameId);
        const diff = auditDiff(
          {
            game: curGame,
            title: cur.title,
            description: cur.description,
            url: cur.url,
            starts_on: fromDbDate(cur.startsOn),
            ends_on: fromDbDate(cur.endsOn),
            start_time: fromDbTime(cur.startTime),
            end_time: fromDbTime(cur.endTime),
          } as Record<string, unknown>,
          {
            game: body.game,
            title: body.title,
            description: body.description,
            url: body.url,
            starts_on: body.starts_on,
            ends_on: body.ends_on,
            start_time: body.start_time,
            end_time: body.end_time,
          },
        );
        if (!diff) return cur;
        // 검사에 쓴 일정 값이 그대로일 때만 쓴다(다른 필드 경합은 공지·패치노트와 같이 마지막 쓰기가 이긴다)
        const r = await tx.calendarEvent.updateMany({
          where: { id, startsOn: cur.startsOn, endsOn: cur.endsOn, startTime: cur.startTime, endTime: cur.endTime },
          data: {
            gameId,
            title: body.title,
            description: body.description,
            url: body.url,
            startsOn: body.starts_on === undefined ? undefined : toDbDate(body.starts_on),
            endsOn: body.ends_on === undefined ? undefined : toDbDate(body.ends_on),
            startTime: dbTimeOrKeep(body.start_time),
            endTime: dbTimeOrKeep(body.end_time),
            updatedAt: now,
          },
        });
        if (r.count !== 1) {
          if (attempt >= EVENT_UPDATE_ATTEMPTS) {
            throw new AppError('INTERNAL_ERROR', undefined, { message: '이벤트 일정 동시 수정 재시도 초과' });
          }
          continue;
        }
        await writeAudit(tx, {
          actorId: admin.id,
          action: 'event.update',
          targetId: id,
          summary: `이벤트 ${auditQuote(body.title ?? cur.title)} 수정`,
          details: diff,
          at: now,
        });
        const updated = await tx.calendarEvent.findUnique({ where: { id } });
        if (!updated) throw new AppError('NOT_FOUND');
        return updated;
      }
    });
    const [view] = await this.eventViews([row]);
    return view as EventView;
  }

  async deleteEvent(admin: AuthUser, id: string): Promise<void> {
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      let deleted: CalendarEvent;
      try {
        deleted = await tx.calendarEvent.delete({ where: { id } });
      } catch (err) {
        if (isNotFound(err)) throw new AppError('NOT_FOUND', undefined, { cause: err });
        throw err;
      }
      await writeAudit(tx, {
        actorId: admin.id,
        action: 'event.delete',
        targetId: id,
        summary: `이벤트 ${auditQuote(deleted.title)} 삭제`,
        details: {
          id: deleted.id,
          game: deleted.gameId === null ? null : await this.gameCodeOf(tx, deleted.gameId),
          title: deleted.title,
          description: deleted.description,
          url: deleted.url,
          starts_on: fromDbDate(deleted.startsOn),
          ends_on: fromDbDate(deleted.endsOn),
          start_time: fromDbTime(deleted.startTime),
          end_time: fromDbTime(deleted.endTime),
          created_by: deleted.createdById,
          created_at: deleted.createdAt,
          updated_at: deleted.updatedAt,
        },
        at: now,
      });
    });
  }
}
