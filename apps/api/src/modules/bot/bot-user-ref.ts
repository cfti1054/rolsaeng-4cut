import { type BotUserRef, isLinkedDiscordId } from '@gcd/shared';
import type { User } from '@prisma/client';
import { discordAvatarUrl } from '../users/me.mapper';

export type BotUserSource = Pick<User, 'id' | 'nickname' | 'discordId' | 'discordAvatar'>;

/** 회원 프로필 화면 URL(`{WEB_ORIGIN}/members/{id}`) */
export function memberProfileUrl(webOrigin: string, userId: string): string {
  return new URL(`/members/${encodeURIComponent(userId)}`, webOrigin).toString();
}

/**
 * 봇 응답의 회원 참조(계약 S5 4-2, D209). 봇 응답에만 discord_id가 들어간다(웹 D38 예외).
 * 연동되지 않은 값(null·`dev-…`)은 null.
 */
export function botUserRef(u: BotUserSource, webOrigin: string): BotUserRef {
  return {
    id: u.id,
    nickname: u.nickname,
    avatar_url: discordAvatarUrl(u.discordId, u.discordAvatar),
    discord_id: isLinkedDiscordId(u.discordId) ? u.discordId : null,
    profile_url: memberProfileUrl(webOrigin, u.id),
  };
}
