import { Injectable } from '@nestjs/common';
import {
  type GetMeResponse,
  NotificationSettings,
  type UpdateMeRequest,
  type UpdateMeResponse,
  type UpdateMyNotificationSettingsRequest,
  isLinkedDiscordId,
} from '@gcd/shared';
import type { User } from '@prisma/client';
import { AppError } from '../../common/app-error';
import { PrismaService, isUniqueViolation } from '../../prisma/prisma.service';
import { toMe } from './me.mapper';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string): Promise<GetMeResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('UNAUTHENTICATED');
    return toMe(user);
  }

  /**
   * PATCH /me(계약 5-7 확인 흐름 3번). input.nickname은 이미 zod(Nickname)로 정규화된 값이다.
   * 다른 사용자가 쓰면 409 NICKNAME_TAKEN. 처음 확인이면 nickname_confirmed_at = now.
   */
  async updateMe(userId: string, input: UpdateMeRequest): Promise<UpdateMeResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('UNAUTHENTICATED');

    if (input.nickname !== user.nickname) {
      const owner = await this.prisma.user.findUnique({
        where: { nickname: input.nickname },
        select: { id: true },
      });
      if (owner && owner.id !== userId) throw new AppError('NICKNAME_TAKEN');
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: {
          nickname: input.nickname,
          ...(user.nicknameConfirmedAt === null ? { nicknameConfirmedAt: new Date() } : {}),
        },
      });
      return toMe(updated);
    } catch (err) {
      // 검사와 저장 사이에 다른 사용자가 같은 닉네임을 가져간 경우
      if (isUniqueViolation(err, 'nickname')) throw new AppError('NICKNAME_TAKEN');
      throw err;
    }
  }

  /** S6 알림 설정(계약 S6 9절, D259). scrim_start·patch 두 항목만. notify_result·notify_waitlist는 노출하지 않는다 */
  private settingsOf(u: Pick<User, 'notifyScrimStart' | 'notifyPatch' | 'discordId'>): NotificationSettings {
    return NotificationSettings.parse({
      scrim_start: u.notifyScrimStart,
      patch: u.notifyPatch,
      discord_linked: isLinkedDiscordId(u.discordId),
    });
  }

  async getNotificationSettings(userId: string): Promise<NotificationSettings> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('UNAUTHENTICATED');
    return this.settingsOf(user);
  }

  async updateNotificationSettings(userId: string, input: UpdateMyNotificationSettingsRequest): Promise<NotificationSettings> {
    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: { notifyScrimStart: input.scrim_start, notifyPatch: input.patch },
      });
      return this.settingsOf(updated);
    } catch (err) {
      if (isNotFound(err)) throw new AppError('UNAUTHENTICATED', undefined, { cause: err });
      throw err;
    }
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2025';
}
