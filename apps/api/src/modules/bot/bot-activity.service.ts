import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { planActivityBatch } from '@gcd/core';
import {
  type BotActivityResult,
  GameCode,
  type PostBotActivityRequest,
  PostBotActivityResponse,
} from '@gcd/shared';
import { Prisma } from '@prisma/client';
import { APP_CLOCK, type Clock } from '../../common/clock';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * POST /bot/activity(계약 S5 6-2). 판정은 core planActivityBatch, 저장은 INSERT … ON CONFLICT DO NOTHING 한 문장.
 * 트랜잭션으로 묶지 않는다: 미리 읽은 키와 저장 사이의 경합은 ON CONFLICT가 막고 RETURNING에 없는 키를 duplicate로 본다.
 */
@Injectable()
export class BotActivityService {
  private readonly log = new Logger('BotActivityService');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  async record(body: PostBotActivityRequest, apiKeyId: string): Promise<PostBotActivityResponse> {
    const now = this.clock.now();
    const events = body.events;
    const keys = [...new Set(events.map((e) => e.idempotency_key))];
    const discordIds = [...new Set(events.map((e) => e.discord_id))];
    const codes = [...new Set(events.flatMap((e) => (e.game ? [e.game] : [])))];

    const stored = await this.prisma.activityLog.findMany({
      where: { idempotencyKey: { in: keys } },
      select: { idempotencyKey: true },
    });
    const users = await this.prisma.user.findMany({
      where: { discordId: { in: discordIds } },
      select: { id: true, discordId: true },
    });
    const games = codes.length ? await this.prisma.game.findMany({ where: { code: { in: codes } } }) : [];
    const gameIdByCode = new Map(games.map((g) => [g.code, g.id]));
    for (const c of codes) {
      if (!gameIdByCode.has(c)) this.log.warn(`games 행 없는 게임 코드 ${c}: game_id = null로 저장`);
    }

    const plan = planActivityBatch({
      events: events.map((e) => ({
        idempotencyKey: e.idempotency_key,
        discordId: e.discord_id,
        startedAt: new Date(e.started_at),
        durationSec: e.duration_sec,
      })),
      storedKeys: new Set(stored.map((s) => s.idempotencyKey)),
      userIdByDiscordId: new Map(users.flatMap((u) => (u.discordId ? [[u.discordId, u.id] as const] : []))),
      now,
    });

    const inserts = plan.flatMap((p, i) => {
      if (p.status !== 'insert') return [];
      const e = events[i];
      if (!e) return [];
      const code = e.game ? GameCode.parse(e.game) : null;
      return [
        Prisma.sql`(${randomUUID()}::uuid, ${p.userId}::uuid, ${e.type}::activity_type, ${
          code ? (gameIdByCode.get(code) ?? null) : null
        }::uuid, ${new Date(e.started_at)}, ${e.duration_sec}, ${e.idempotency_key}, ${apiKeyId}::uuid, ${now})`,
      ];
    });
    const created = new Set<string>();
    if (inserts.length > 0) {
      const rows = await this.prisma.$queryRaw<{ idempotency_key: string }[]>`
        /* gcd:activity-insert */
        INSERT INTO activity_logs (id, user_id, type, game_id, started_at, duration_sec, idempotency_key, api_key_id, created_at)
        VALUES ${Prisma.join(inserts)}
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING idempotency_key`;
      for (const r of rows) created.add(r.idempotency_key);
    }

    const results: BotActivityResult[] = plan.map((p, i) => {
      const key = events[i]?.idempotency_key as string;
      switch (p.status) {
        case 'insert':
          return { idempotency_key: key, status: created.has(key) ? 'created' : 'duplicate', reason: null };
        case 'rejected':
          return { idempotency_key: key, status: 'rejected', reason: p.reason };
        default:
          return { idempotency_key: key, status: p.status, reason: null };
      }
    });
    const counts = { created: 0, duplicate: 0, unlinked: 0, rejected: 0 };
    for (const r of results) counts[r.status] += 1;
    return PostBotActivityResponse.parse({ results, counts });
  }
}
