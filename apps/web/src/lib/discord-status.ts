import { isLinkedDiscordId, type Me } from '@gcd/shared';

/**
 * 설정 디스코드 영역 2상태(계약 S5 10절, D237·D238). 데이터는 GET /me뿐이다.
 * 연동 코드 흐름은 없다 — 디스코드 OAuth 로그인 때 채워지는 discord_id가 곧 연동이다.
 */
export type DiscordStatus = 'linked' | 'unlinked';

export function discordStatus(me: Pick<Me, 'discord_id'>): DiscordStatus {
  return isLinkedDiscordId(me.discord_id) ? 'linked' : 'unlinked';
}

export const DISCORD_LINKED_DESCRIPTION = '음성 접속 시간이 활동 랭킹에 쌓이고, 내전 시작 알림을 디스코드로 받아요.';
export const DISCORD_UNLINKED_DESCRIPTION = '디스코드로 로그인하면 자동으로 연동돼요.';
