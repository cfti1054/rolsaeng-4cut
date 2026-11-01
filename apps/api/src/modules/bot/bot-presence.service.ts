import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { checkPresenceCapture } from '@gcd/core';
import { BotPresencePlayingStored, type PutBotPresenceRequest, PutBotPresenceResponse } from '@gcd/shared';
import { APP_CLOCK, type Clock } from '../../common/clock';
import { PrismaService } from '../../prisma/prisma.service';

/** bot_presence.source. 디스코드 서버는 하나라고 가정한다(Q9) */
export const BOT_PRESENCE_SOURCE = 'default';

/**
 * PUT /bot/presence(계약 S5 6-7). 마지막 1행만 둔다(이력 없음).
 * 시각 범위는 core checkPresenceCapture, 순서는 `WHERE bot_presence.captured_at < EXCLUDED.captured_at` 조건부 덮어쓰기.
 */
@Injectable()
export class BotPresenceService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  async put(body: PutBotPresenceRequest, apiKeyId: string): Promise<PutBotPresenceResponse> {
    const now = this.clock.now();
    const capturedAt = new Date(body.captured_at);
    const reason = checkPresenceCapture({ capturedAt, storedCapturedAt: null, now });
    if (reason !== null) return PutBotPresenceResponse.parse({ accepted: false, reason });

    const playing = JSON.stringify(BotPresencePlayingStored.parse(body.playing));
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      /* gcd:presence-upsert */
      INSERT INTO bot_presence (id, source, captured_at, voice_member_count, playing, api_key_id, created_at, updated_at)
      VALUES (${randomUUID()}::uuid, ${BOT_PRESENCE_SOURCE}, ${capturedAt}, ${body.voice_member_count}, ${playing}::jsonb,
              ${apiKeyId}::uuid, ${now}, ${now})
      ON CONFLICT (source) DO UPDATE SET
        captured_at = EXCLUDED.captured_at,
        voice_member_count = EXCLUDED.voice_member_count,
        playing = EXCLUDED.playing,
        api_key_id = EXCLUDED.api_key_id,
        updated_at = EXCLUDED.updated_at
      WHERE bot_presence.captured_at < EXCLUDED.captured_at
      RETURNING id::text AS id`;
    return PutBotPresenceResponse.parse(
      rows.length > 0 ? { accepted: true, reason: null } : { accepted: false, reason: 'OLDER_THAN_STORED' },
    );
  }
}
