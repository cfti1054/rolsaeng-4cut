import { describe, expect, it } from 'vitest';
import type { NewVoiceSession } from './session-store';
import { handleVoiceState, notePlayingGame } from './voice-handler';
import type { VoiceSession } from './voice-session';

function memory() {
  const open = new Map<string, VoiceSession>();
  let seq = 0;
  const closed: string[] = [];
  return {
    closed,
    async findOpen(_guildId: string, discordId: string) {
      return open.get(discordId) ?? null;
    },
    async touch(id: string, patch: { channelId: string; lastSeenAt: Date }) {
      for (const session of open.values()) {
        if (session.id === id) {
          session.channelId = patch.channelId;
          session.lastSeenAt = patch.lastSeenAt;
        }
      }
    },
    async insertOpen(input: NewVoiceSession) {
      seq += 1;
      const session: VoiceSession = {
        id: `s${seq}`,
        guildId: input.guildId,
        discordId: input.discordId,
        channelId: input.channelId,
        startedAt: input.startedAt,
        lastSeenAt: input.startedAt,
        game: input.game,
        closedAt: null,
      };
      open.set(input.discordId, session);
      return session;
    },
    async close(id: string) {
      closed.push(id);
      for (const [discordId, session] of open) {
        if (session.id === id) open.delete(discordId);
      }
    },
    async setGame(id: string, game: VoiceSession['game']) {
      for (const session of open.values()) {
        if (session.id === id) session.game = game;
      }
    },
    open,
  };
}

describe('음성 상태', () => {
  const at = new Date('2026-10-27T11:10:00.000Z');
  const base = { guildId: 'g', discordId: '123456789012345678', bot: false, at };

  it('입장하면 세션을 열고 퇴장하면 닫은 뒤 전송한다', async () => {
    const store = memory();
    let flushed = 0;
    await handleVoiceState(store, 'g', { ...base, beforeChannelId: null, afterChannelId: 'c1' }, async () => {
      flushed += 1;
    });
    expect(store.open.size).toBe(1);
    expect(flushed).toBe(0);
    await handleVoiceState(store, 'g', { ...base, beforeChannelId: 'c1', afterChannelId: null }, async () => {
      flushed += 1;
    });
    expect(store.closed).toEqual(['s1']);
    expect(flushed).toBe(1);
  });

  it('게임을 끄면 마지막 게임을 유지한다', async () => {
    const store = memory();
    await store.insertOpen({ guildId: 'g', discordId: base.discordId, channelId: 'c', startedAt: at, game: null });
    await notePlayingGame(store, 'g', base.discordId, false, 'lol');
    await notePlayingGame(store, 'g', base.discordId, false, null);
    expect(store.open.get(base.discordId)?.game).toBe('lol');
  });
});
