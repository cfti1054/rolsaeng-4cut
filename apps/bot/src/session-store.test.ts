import { describe, expect, it } from 'vitest';
import { createBotStore, type SqlClient } from './session-store';

function fakeDb(handler: (sql: string, params: unknown[]) => { rows: unknown[] } | never): SqlClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push(sql);
      const result = handler(sql, params);
      return result;
    },
  };
}

describe('세션 저장소', () => {
  it('열린 세션을 넣고 읽는다', async () => {
    const started = new Date('2026-10-27T11:10:00.000Z');
    const db = fakeDb((sql) => {
      if (sql.includes('INSERT INTO bot_voice_sessions')) {
        return {
          rows: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              guild_id: 'g',
              discord_id: '123456789012345678',
              channel_id: 'c',
              started_at: started,
              last_seen_at: started,
              game: 'nope',
              closed_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const store = createBotStore(db);
    const session = await store.insertOpen({
      guildId: 'g',
      discordId: '123456789012345678',
      channelId: 'c',
      startedAt: started,
      game: null,
    });
    expect(session.game).toBeNull();
    expect(session.startedAt.toISOString()).toBe(started.toISOString());
  });

  it('같은 회원이 이미 열려 있으면 그 세션의 채널을 갱신한다', async () => {
    const started = new Date('2026-10-27T11:00:00.000Z');
    const db = fakeDb((sql) => {
      if (sql.includes('INSERT INTO bot_voice_sessions')) {
        const err = new Error('duplicate') as Error & { code: string };
        err.code = '23505';
        throw err;
      }
      if (sql.includes('SELECT')) {
        return {
          rows: [
            {
              id: 'keep',
              guild_id: 'g',
              discord_id: '123456789012345678',
              channel_id: 'old',
              started_at: started,
              last_seen_at: started,
              game: 'lol',
              closed_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const store = createBotStore(db);
    const session = await store.insertOpen({
      guildId: 'g',
      discordId: '123456789012345678',
      channelId: 'new',
      startedAt: new Date('2026-10-27T11:10:00.000Z'),
      game: null,
    });
    expect(session.id).toBe('keep');
    expect(session.channelId).toBe('new');
    expect(db.calls.some((sql) => sql.includes('UPDATE bot_voice_sessions'))).toBe(true);
  });
});
