import { Inject, Injectable } from '@nestjs/common';
import {
  BOT_ANNOUNCEMENT_PENDING_LIMIT,
  BOT_ANNOUNCEMENT_PENDING_MAX_AGE_HOURS,
  GetBotPendingNoticesResponse,
  GetBotPendingPatchNotesResponse,
  PostBotDeliveredResponse,
  isLinkedDiscordId,
} from '@gcd/shared';
import { AppError } from '../../common/app-error';
import { APP_CLOCK, type Clock } from '../../common/clock';
import { fromDbDate } from '../../common/db-date';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { ScrimViews } from '../scrims/scrim-views.service';
import { botUserRef } from './bot-user-ref';

const HOUR_MS = 3_600_000;

/**
 * S6 공지·패치노트 디스코드 전송(계약 S6 8-4, D255·D256). 서버는 디스코드를 부르지 않는다 — 봇이 가져가 보내고 delivered를 알린다.
 * 대기 = notify_discord && discord_notified_at IS NULL && created_at ≥ now − 72h, created_at ASC·id ASC, 최대 20.
 * delivered는 멱등(조건부 update 1행 → delivered, 0행 → 다시 읽어 already_delivered 또는 NOT_FOUND). notify_discord 값과 무관.
 */
@Injectable()
export class BotAnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly views: ScrimViews,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  private newsUrl(): string {
    return new URL('/news', this.config.webOrigin).toString();
  }

  private pendingWhere(now: Date) {
    return {
      notifyDiscord: true,
      discordNotifiedAt: null,
      createdAt: { gte: new Date(now.getTime() - BOT_ANNOUNCEMENT_PENDING_MAX_AGE_HOURS * HOUR_MS) },
    };
  }

  /** GET /bot/notices/pending */
  async pendingNotices(): Promise<GetBotPendingNoticesResponse> {
    const now = this.clock.now();
    const rows = await this.prisma.notice.findMany({
      where: this.pendingWhere(now),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: BOT_ANNOUNCEMENT_PENDING_LIMIT,
    });
    const authorIds = [...new Set(rows.map((r) => r.authorId))];
    const authors =
      authorIds.length === 0 ? [] : await this.prisma.user.findMany({ where: { id: { in: authorIds } } });
    const byId = new Map(authors.map((u) => [u.id, u]));
    const webUrl = this.newsUrl();
    return GetBotPendingNoticesResponse.parse({
      items: rows.map((r) => {
        const author = byId.get(r.authorId);
        if (!author) throw new AppError('INTERNAL_ERROR', undefined, { message: '공지 작성자 없음' });
        return {
          id: r.id,
          title: r.title,
          body: r.body,
          author: botUserRef(author, this.config.webOrigin),
          created_at: r.createdAt.toISOString(),
          web_url: webUrl,
        };
      }),
      next_cursor: null,
      generated_at: now.toISOString(),
    });
  }

  /** GET /bot/patch-notes/pending. notify_discord_ids = 연동 && notify_patch && 탈퇴 아님(요청마다 1쿼리, 행마다 같은 배열, D260) */
  async pendingPatchNotes(): Promise<GetBotPendingPatchNotesResponse> {
    const now = this.clock.now();
    const rows = await this.prisma.patchNote.findMany({
      where: this.pendingWhere(now),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: BOT_ANNOUNCEMENT_PENDING_LIMIT,
    });
    let ids: string[] = [];
    if (rows.length > 0) {
      const subscribers = await this.prisma.user.findMany({
        where: { notifyPatch: true, leftAt: null },
        select: { discordId: true },
        orderBy: [{ id: 'asc' }],
      });
      ids = subscribers.map((u) => u.discordId).filter((d): d is string => isLinkedDiscordId(d));
    }
    const games = rows.length > 0 ? await this.views.gamesById() : new Map();
    const webUrl = this.newsUrl();
    return GetBotPendingPatchNotesResponse.parse({
      items: rows.map((r) => {
        const game = games.get(r.gameId);
        if (!game) throw new AppError('INTERNAL_ERROR', undefined, { message: '패치노트 게임 없음' });
        return {
          id: r.id,
          game: this.views.gameRef(game),
          version: r.version,
          title: r.title,
          summary: r.summary,
          url: r.url,
          published_on: fromDbDate(r.publishedOn),
          created_at: r.createdAt.toISOString(),
          web_url: webUrl,
          notify_discord_ids: ids,
        };
      }),
      next_cursor: null,
      generated_at: now.toISOString(),
    });
  }

  /** POST /bot/notices/:id/delivered */
  async noticeDelivered(id: string): Promise<PostBotDeliveredResponse> {
    const now = this.clock.now();
    const r = await this.prisma.notice.updateMany({ where: { id, discordNotifiedAt: null }, data: { discordNotifiedAt: now } });
    if (r.count === 1) return PostBotDeliveredResponse.parse({ id, status: 'delivered', discord_notified_at: now.toISOString() });
    const row = await this.prisma.notice.findUnique({ where: { id } });
    return this.already(id, row);
  }

  /** POST /bot/patch-notes/:id/delivered */
  async patchNoteDelivered(id: string): Promise<PostBotDeliveredResponse> {
    const now = this.clock.now();
    const r = await this.prisma.patchNote.updateMany({ where: { id, discordNotifiedAt: null }, data: { discordNotifiedAt: now } });
    if (r.count === 1) return PostBotDeliveredResponse.parse({ id, status: 'delivered', discord_notified_at: now.toISOString() });
    const row = await this.prisma.patchNote.findUnique({ where: { id } });
    return this.already(id, row);
  }

  private already(id: string, row: { discordNotifiedAt: Date | null } | null): PostBotDeliveredResponse {
    if (!row) throw new AppError('NOT_FOUND');
    if (row.discordNotifiedAt === null) {
      // 조건부 update 0행인데 값이 비어 있음: 그사이 삭제·재생성 같은 경합 밖 상황 — 다시 시도하면 된다
      throw new AppError('INTERNAL_ERROR', undefined, { message: 'delivered 기록 경합' });
    }
    return PostBotDeliveredResponse.parse({
      id,
      status: 'already_delivered',
      discord_notified_at: row.discordNotifiedAt.toISOString(),
    });
  }
}
