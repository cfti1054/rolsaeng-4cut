import { Inject, Injectable } from '@nestjs/common';
import { planMemberEvents } from '@gcd/core';
import {
  type BotMemberEventResult,
  type PostBotMemberEventsRequest,
  PostBotMemberEventsResponse,
} from '@gcd/shared';
import { advisoryXactLock, membershipLockKey } from '../../common/advisory-lock';
import { APP_CLOCK, type Clock } from '../../common/clock';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * POST /bot/member-events(계약 S5 6-6, D220·D230). 순서 판정은 core planMemberEvents.
 * 사용자별 advisory lock(user id 오름차순) + guild_membership_at 조건부 update로, 겹친 요청 중 더 새 판단만 남긴다.
 * 최종 상태가 퇴장이면 그 회원의 미폐기 리프레시 토큰을 전부 폐기한다(S0 D24).
 */
@Injectable()
export class BotMembersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  async apply(body: PostBotMemberEventsRequest): Promise<PostBotMemberEventsResponse> {
    const now = this.clock.now();
    const discordIds = [...new Set(body.events.map((e) => e.discord_id))];
    const users = await this.prisma.user.findMany({
      where: { discordId: { in: discordIds } },
      select: { id: true, discordId: true, guildMembershipAt: true },
    });
    const plan = planMemberEvents({
      events: body.events.map((e) => ({ discordId: e.discord_id, type: e.type, occurredAt: new Date(e.occurred_at) })),
      users: new Map(
        users.flatMap((u) =>
          u.discordId ? [[u.discordId, { userId: u.id, guildMembershipAt: u.guildMembershipAt }] as const] : [],
        ),
      ),
      now,
    });
    const statuses = [...plan.results];

    if (plan.finals.length > 0) {
      const finals = [...plan.finals].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
      await this.prisma.$transaction(async (tx) => {
        for (const f of finals) await advisoryXactLock(tx, membershipLockKey(f.userId));
        for (const f of finals) {
          const r = await tx.user.updateMany({
            where: {
              id: f.userId,
              OR: [{ guildMembershipAt: null }, { guildMembershipAt: { lt: f.guildMembershipAt } }],
            },
            data: { leftAt: f.leftAt, guildMembershipAt: f.guildMembershipAt },
          });
          if (r.count === 0) {
            for (const i of f.eventIndexes) statuses[i] = 'stale';
            continue;
          }
          if (f.revokeTokens) {
            await tx.refreshToken.updateMany({ where: { userId: f.userId, revokedAt: null }, data: { revokedAt: now } });
          }
        }
      });
    }

    const results: BotMemberEventResult[] = body.events.map((e, i) => ({
      discord_id: e.discord_id,
      type: e.type,
      status: statuses[i] ?? 'stale',
    }));
    return PostBotMemberEventsResponse.parse({ results });
  }
}
