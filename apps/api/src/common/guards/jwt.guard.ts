import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ACCESS_TOKEN_TYPE } from '@gcd/shared';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../app-error';
import type { AuthedRequest } from '../decorators/current-user';
import { verifyAccessToken } from '../jwt';

/**
 * `Authorization: Bearer {jwt}` 검사(계약 5-2).
 * 헤더 없음·형식 오류·서명 불일치·typ≠access → UNAUTHENTICATED, exp 경과 → ACCESS_TOKEN_EXPIRED,
 * sub 사용자가 DB에 없음 → UNAUTHENTICATED.
 */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const prefix = `${ACCESS_TOKEN_TYPE} `;
    if (typeof header !== 'string' || !header.startsWith(prefix)) {
      throw new AppError('UNAUTHENTICATED');
    }
    const token = header.slice(prefix.length).trim();
    if (!token) throw new AppError('UNAUTHENTICATED');

    const result = verifyAccessToken(token, this.config.jwtAccessSecret);
    if (!result.ok) {
      throw new AppError(result.reason === 'expired' ? 'ACCESS_TOKEN_EXPIRED' : 'UNAUTHENTICATED');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: result.claims.sub },
      select: { id: true },
    });
    if (!user) throw new AppError('UNAUTHENTICATED');

    req.authUser = { id: result.claims.sub, role: result.claims.role };
    return true;
  }
}
