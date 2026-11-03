import { PutBotPresenceRequest } from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import { mapActivityName } from './game-map';
import { aggregatePlaying, buildPresenceBody } from './presence';

describe('플레이 집계', () => {
  it('롤 이름을 코드로 바꾸고 봇은 인원에서 뺀다', () => {
    expect(mapActivityName('League of Legends')).toEqual({ game: 'lol', steamAppId: null });
    expect(mapActivityName('알 수 없는 게임').game).toBeNull();
    const body = buildPresenceBody({
      voice: [{ bot: false }, { bot: true }, { bot: false }],
      playing: [
        { bot: false, name: 'League of Legends' },
        { bot: false, name: 'League of Legends' },
        { bot: true, name: 'League of Legends' },
        { bot: false, name: '  ' },
      ],
      capturedAt: new Date('2026-10-27T11:00:00.000Z'),
    });
    expect(body.voice_member_count).toBe(2);
    expect(body.playing).toEqual([{ name: 'League of Legends', game: 'lol', steam_app_id: null, count: 2 }]);
    expect(PutBotPresenceRequest.parse(body).captured_at).toBe('2026-10-27T20:00:00.000+09:00');
  });

  it('많은 게임만 20개까지 남긴다', () => {
    const members = Array.from({ length: 21 }, (_, index) => ({
      name: `Game ${String(index).padStart(2, '0')}`,
      game: null,
      steamAppId: null,
    }));
    const grouped = aggregatePlaying(members);
    expect(grouped).toHaveLength(20);
  });
});
