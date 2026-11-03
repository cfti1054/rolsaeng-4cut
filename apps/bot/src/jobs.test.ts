import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './api-client';
import { DmError, flushActivities, notifyUpcomingScrims } from './jobs';
import type { Logger } from './log';
import type { VoiceSession } from './voice-session';

const silent: Logger = { info() {}, error() {} };

function closedSession(): VoiceSession {
  return {
    id: 's1',
    guildId: 'g',
    discordId: '123456789012345678',
    channelId: 'c',
    startedAt: new Date('2026-10-27T11:10:00.000Z'),
    lastSeenAt: new Date('2026-10-27T12:10:00.000Z'),
    game: 'lol',
    closedAt: new Date('2026-10-27T12:10:00.000Z'),
  };
}

describe('활동 전송', () => {
  it('성공하면 보낸 것으로 표시한다', async () => {
    const delivered: string[] = [];
    let sent = 0;
    await flushActivities(
      {
        listPending: async () => [closedSession()],
        markDelivered: async (id) => {
          delivered.push(id);
        },
      },
      {
        postActivity: async () => {
          sent += 1;
          return {
            results: [],
            counts: { created: 1, duplicate: 0, unlinked: 0, rejected: 0 },
          };
        },
      },
      'g',
      silent,
    );
    expect(sent).toBe(1);
    expect(delivered).toEqual(['s1']);
  });

  it('5xx면 표시하지 않아 다음에 같은 키로 다시 보낸다', async () => {
    const delivered: string[] = [];
    await flushActivities(
      {
        listPending: async () => [closedSession()],
        markDelivered: async (id) => {
          delivered.push(id);
        },
      },
      {
        postActivity: async () => {
          throw new ApiRequestError(503, 'INTERNAL_ERROR', true);
        },
      },
      'g',
      silent,
    );
    expect(delivered).toEqual([]);
  });
});

describe('내전 시작 알림', () => {
  it('이미 보낸 회원은 건너뛰고, DM 거부는 다시 시도하지 않는다', async () => {
    const sent = new Set<string>();
    const dms: string[] = [];
    const scrim = {
      id: '11111111-1111-4111-8111-111111111111',
      title: '골드 내전',
      url: 'http://localhost:3000/scrims/11111111-1111-4111-8111-111111111111',
      game: { code: 'lol' as const, name: '리그 오브 레전드', has_positions: true, has_teams: true, has_results: true, positions: [] },
      status: 'recruiting' as const,
      scheduled_at: '2026-10-27T20:40:00.000+09:00',
      capacity: 10,
      joined_count: 8,
      waitlist_count: 0,
      host: {
        id: '22222222-2222-4222-8222-222222222222',
        nickname: '호스트',
        avatar_url: null,
        discord_id: '123456789012345671',
        profile_url: 'http://localhost:3000/members/22222222-2222-4222-8222-222222222222',
      },
      notify_discord_ids: ['123456789012345678', '123456789012345679'],
    };
    await notifyUpcomingScrims({
      store: {
        wasDirectMessage: async (_kind, _id, _at, discordId) => sent.has(discordId),
        markDirectMessage: async (_kind, _id, _at, discordId) => {
          sent.add(discordId);
        },
      },
      withinMin: 30,
      load: async () => ({ items: [scrim] }),
      send: async (discordId) => {
        dms.push(discordId);
        if (discordId.endsWith('9')) throw new DmError(true);
      },
      logger: silent,
    });
    expect(dms).toEqual(['123456789012345678', '123456789012345679']);
    dms.length = 0;
    await notifyUpcomingScrims({
      store: {
        wasDirectMessage: async (_kind, _id, _at, discordId) => sent.has(discordId),
        markDirectMessage: async () => undefined,
      },
      withinMin: 30,
      load: async () => ({ items: [scrim] }),
      send: async (discordId) => {
        dms.push(discordId);
      },
      logger: silent,
    });
    expect(dms).toEqual([]);
  });
});
