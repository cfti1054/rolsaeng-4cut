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
 * S6(D263): role은 토큰 claim이 아니라 DB 값을 쓴다(이미 하는 사용자 조회에 role 열 추가). 웹 강등이 다음 요청부터 반영된다.
 * 토큰에는 여전히 role을 넣는다(옛 클라이언트 호환) — 서버는 읽지 않는다.
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
      select: { id: true, role: true },
    });
    if (!user) throw new AppError('UNAUTHENTICATED');

    req.authUser = { id: user.id, role: user.role };
    return true;
  }
}
