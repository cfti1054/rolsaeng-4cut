import { PostBotActivityRequest } from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import { formatIsoWithKstOffset, kstCompact, nextKstMidnight } from './time';
import { planVoiceRecovery, toVoiceActivityEvents, voiceSegments, type VoiceSession } from './voice-session';

const DISCORD_ID = '123456789012345678';

function at(iso: string): Date {
  return new Date(iso);
}

function session(partial: Partial<VoiceSession> & Pick<VoiceSession, 'id' | 'discordId'>): VoiceSession {
  return {
    guildId: '100000000000000001',
    channelId: '200000000000000001',
    startedAt: at('2026-10-27T11:10:00.000Z'),
    lastSeenAt: at('2026-10-27T11:10:00.000Z'),
    game: null,
    closedAt: null,
    ...partial,
  };
}

describe('KST 시각', () => {
  it('UTC를 +09:00으로 적는다', () => {
    const instant = at('2026-10-27T11:10:00.000Z');
    expect(formatIsoWithKstOffset(instant)).toBe('2026-10-27T20:10:00.000+09:00');
    expect(kstCompact(instant)).toBe('20261027T201000');
    expect(nextKstMidnight(instant).toISOString()).toBe('2026-10-27T15:00:00.000Z');
  });

  it('자정 정각의 다음 자정은 다음 날이다', () => {
    expect(nextKstMidnight(at('2026-10-27T15:00:00.000Z')).toISOString()).toBe('2026-10-28T15:00:00.000Z');
  });
});

describe('음성 세션 나누기', () => {
  it('KST 자정을 넘으면 이벤트를 둘로 나누고 스키마를 통과한다', () => {
    const startedAt = at('2026-10-27T11:10:00.000Z');
    const endedAt = at('2026-10-27T16:00:00.000Z');
    const segments = voiceSegments(DISCORD_ID, startedAt, endedAt);
    expect(segments.map((segment) => segment.durationSec)).toEqual([3 * 3600 + 50 * 60, 3600]);
    expect(segments.map((segment) => segment.idempotencyKey)).toEqual([
      `voice-${DISCORD_ID}-20261027T201000`,
      `voice-${DISCORD_ID}-20261028T000000`,
    ]);
    const events = toVoiceActivityEvents(
      session({ id: 's1', discordId: DISCORD_ID, startedAt, game: 'lol', closedAt: endedAt }),
      endedAt,
    );
    expect(PostBotActivityRequest.parse({ events }).events[1]?.game).toBe('lol');
  });

  it('1초 미만은 보내지 않는다', () => {
    const start = at('2026-10-27T11:10:00.000Z');
    expect(voiceSegments(DISCORD_ID, start, new Date(start.getTime() + 500))).toEqual([]);
  });
});

describe('재시작 복구', () => {
  const now = at('2026-10-27T12:00:00.000Z');

  it('남아 있으면 잇고, 없으면 last_seen으로 닫고, 새 사람은 지금 연다', () => {
    const staying = session({
      id: 'stay',
      discordId: '123456789012345671',
      channelId: '200000000000000001',
      lastSeenAt: at('2026-10-27T11:40:00.000Z'),
    });
    const gone = session({
      id: 'gone',
      discordId: '123456789012345672',
      lastSeenAt: at('2026-10-27T11:30:00.000Z'),
    });
    const plan = planVoiceRecovery(
      [staying, gone],
      [
        { discordId: staying.discordId, channelId: '200000000000000009' },
        { discordId: '123456789012345673', channelId: '200000000000000002' },
      ],
      now,
    );
    expect(plan.keep).toEqual([{ id: 'stay', channelId: '200000000000000009', lastSeenAt: now }]);
    expect(plan.close).toEqual([{ id: 'gone', closedAt: gone.lastSeenAt }]);
    expect(plan.open).toEqual([{ discordId: '123456789012345673', channelId: '200000000000000002', at: now }]);
  });

  it('같은 사람의 열린 세션이 둘이면 늦은 것만 남긴다', () => {
    const older = session({ id: 'old', discordId: DISCORD_ID, startedAt: at('2026-10-27T10:00:00.000Z') });
    const newer = session({ id: 'new', discordId: DISCORD_ID, startedAt: at('2026-10-27T11:00:00.000Z') });
    const plan = planVoiceRecovery([older, newer], [{ discordId: DISCORD_ID, channelId: '200000000000000001' }], now);
    expect(plan.keep.map((row) => row.id)).toEqual(['new']);
    expect(plan.close.map((row) => row.id)).toEqual(['old']);
  });
});
