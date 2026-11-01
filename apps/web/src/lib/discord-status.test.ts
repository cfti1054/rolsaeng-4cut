import { describe, expect, it } from 'vitest';
import { DISCORD_UNLINKED_DESCRIPTION, discordStatus } from './discord-status';

describe('설정 디스코드 2상태(D238)', () => {
  it('snowflake → 연동됨, null·dev-… → 미연동', () => {
    expect(discordStatus({ discord_id: '123456789012345678' })).toBe('linked');
    expect(discordStatus({ discord_id: 'dev-host_kim' })).toBe('unlinked');
    expect(discordStatus({ discord_id: null })).toBe('unlinked');
  });
  it('미연동 안내 문구', () => {
    expect(DISCORD_UNLINKED_DESCRIPTION).toBe('디스코드로 로그인하면 자동으로 연동돼요.');
  });
});
