import { Injectable } from '@nestjs/common';
import type { GetMeResponse, UpdateMeRequest, UpdateMeResponse } from '@gcd/shared';
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
}
