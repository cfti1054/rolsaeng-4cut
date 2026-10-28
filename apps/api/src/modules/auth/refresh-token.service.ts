import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { RefreshToken } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../prisma/prisma.service';

/** 회전된 토큰을 다시 써도 재사용으로 보지 않는 유예(동시 탭, 계약 5-3 4번) */
export const REFRESH_REUSE_GRACE_MS = 10_000;

export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function newRawToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface IssuedRefreshToken {
  raw: string;
  expiresAt: Date;
}

export type RotateResult =
  /** 정상 회전: 새 쿠키를 내려야 한다 */
  | { kind: 'rotated'; userId: string; next: IssuedRefreshToken }
  /** 유예 기간 내 재사용: 새 액세스 토큰만, Set-Cookie 없음 */
  | { kind: 'grace'; userId: string };

/** 회전 경쟁에서 진 경우(조건부 update 영향 행 0) 트랜잭션을 되돌리기 위한 신호 */
class LostRotationRace extends Error {}

/**
 * 리프레시 토큰 저장·회전·폐기(계약 5-2~5-4).
 * - 원문은 저장하지 않고 SHA-256(hex)만 저장한다.
 * - 수명은 로그인 시점부터 절대 만료(회전해도 같은 expires_at).
 * 실패는 AppError(REFRESH_TOKEN_INVALID | REFRESH_TOKEN_REUSED). 쿠키 삭제는 컨트롤러가 한다.
 */
@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** 새 계열(family)의 첫 토큰을 발급한다(로그인). */
  async issueNewFamily(userId: string, userAgent?: string): Promise<IssuedRefreshToken> {
    const raw = newRawToken();
    const expiresAt = new Date(Date.now() + this.config.refreshTokenTtlDays * 86_400_000);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashRefreshToken(raw),
        familyId: randomUUID(),
        expiresAt,
        userAgent: userAgent?.slice(0, 512) ?? null,
      },
    });
    return { raw, expiresAt };
  }

  async rotate(raw: string | undefined, userAgent?: string): Promise<RotateResult> {
    if (!raw) throw new AppError('REFRESH_TOKEN_INVALID');
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(raw) },
    });
    const now = new Date();
    if (!token || token.expiresAt.getTime() <= now.getTime()) {
      throw new AppError('REFRESH_TOKEN_INVALID');
    }
    if (token.revokedAt) return this.handleRevoked(token, now);

    const nextRaw = newRawToken();
    const nextId = randomUUID();
    try {
      await this.prisma.$transaction(async (tx) => {
        // 조건부 update: 동시에 같은 토큰을 회전하면 한쪽만 성공한다(계약 5-3 6번).
        const updated = await tx.refreshToken.updateMany({
          where: { id: token.id, revokedAt: null },
          data: { revokedAt: now, replacedById: nextId },
        });
        if (updated.count === 0) throw new LostRotationRace();
        await tx.refreshToken.create({
          data: {
            id: nextId,
            userId: token.userId,
            tokenHash: hashRefreshToken(nextRaw),
            familyId: token.familyId,
            expiresAt: token.expiresAt,
            userAgent: userAgent?.slice(0, 512) ?? token.userAgent,
          },
        });
      });
    } catch (err) {
      if (!(err instanceof LostRotationRace)) throw err;
      const latest = await this.prisma.refreshToken.findUnique({ where: { id: token.id } });
      if (!latest?.revokedAt) throw new AppError('REFRESH_TOKEN_INVALID');
      return this.handleRevoked(latest, new Date());
    }
    return { kind: 'rotated', userId: token.userId, next: { raw: nextRaw, expiresAt: token.expiresAt } };
  }

  /** 이미 폐기된 토큰이 들어온 경우(계약 5-3 4번) */
  private async handleRevoked(token: RefreshToken, now: Date): Promise<RotateResult> {
    const revokedAt = token.revokedAt as Date;
    if (!token.replacedById) {
      // 로그아웃·재사용 감지로 폐기된 토큰
      throw new AppError('REFRESH_TOKEN_INVALID');
    }
    if (now.getTime() - revokedAt.getTime() <= REFRESH_REUSE_GRACE_MS) {
      // 동시 탭 유예. 단, 그 사이 로그아웃·재사용 감지로 계열 전체가 폐기됐으면 거절한다.
      const alive = await this.prisma.refreshToken.findFirst({
        where: { familyId: token.familyId, revokedAt: null, expiresAt: { gt: now } },
        select: { id: true },
      });
      if (!alive) throw new AppError('REFRESH_TOKEN_INVALID');
      return { kind: 'grace', userId: token.userId };
    }
    await this.revokeFamily(token.familyId, now);
    throw new AppError('REFRESH_TOKEN_REUSED');
  }

  async revokeFamily(familyId: string, now: Date = new Date()): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  /** 로그아웃: 아는 토큰이면 계열 전체 폐기. 모르는 토큰·없음은 조용히 무시(계약 5-4). */
  async revokeByRaw(raw: string | undefined): Promise<void> {
    if (!raw) return;
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(raw) },
      select: { familyId: true },
    });
    if (token) await this.revokeFamily(token.familyId);
  }
}
