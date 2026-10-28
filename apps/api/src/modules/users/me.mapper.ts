import { Me } from '@gcd/shared';
import type { User } from '@prisma/client';
import { serialize } from '../../common/serialize';

/** 개발 전용 로그인 사용자의 discord_id 접두사(계약 5-8) */
export const DEV_DISCORD_ID_PREFIX = 'dev-';

/** `https://cdn.discordapp.com/avatars/{discord_id}/{hash}.png?size=128`. 해시 없거나 개발 사용자면 null */
export function discordAvatarUrl(discordId: string | null, avatarHash: string | null): string | null {
  if (!discordId || !avatarHash || discordId.startsWith(DEV_DISCORD_ID_PREFIX)) return null;
  return `https://cdn.discordapp.com/avatars/${encodeURIComponent(discordId)}/${encodeURIComponent(avatarHash)}.png?size=128`;
}

export type MeSource = Pick<
  User,
  | 'id'
  | 'nickname'
  | 'role'
  | 'email'
  | 'discordId'
  | 'discordUsername'
  | 'discordAvatar'
  | 'discordGuildVerifiedAt'
  | 'nicknameConfirmedAt'
  | 'createdAt'
>;

/** users 행 → shared `Me`(snake_case, 스키마 검증 포함) */
export function toMe(user: MeSource): Me {
  return serialize(Me, {
    id: user.id,
    nickname: user.nickname,
    role: user.role,
    email: user.email,
    discordId: user.discordId,
    discordUsername: user.discordUsername,
    avatarUrl: discordAvatarUrl(user.discordId, user.discordAvatar),
    discordGuildVerifiedAt: user.discordGuildVerifiedAt,
    needsNicknameConfirmation: user.nicknameConfirmedAt === null,
    createdAt: user.createdAt,
  });
}
