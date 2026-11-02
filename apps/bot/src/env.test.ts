import { describe, expect, it } from 'vitest';
import { readBotEnv } from './env';

describe('환경 변수', () => {
  it('빠진 값의 이름만 말하고 비밀은 메시지에 넣지 않는다', () => {
    expect(() =>
      readBotEnv({
        DISCORD_BOT_TOKEN: 'super-secret-token',
        DISCORD_GUILD_ID: 'not-a-snowflake',
      }),
    ).toThrow(/DISCORD_GUILD_ID/);
    try {
      readBotEnv({ DISCORD_BOT_TOKEN: 'super-secret-token' });
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).not.toContain('super-secret-token');
    }
  });
});
