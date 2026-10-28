import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserRole } from '@gcd/shared';
import type { Request } from 'express';

/** JwtGuard가 요청에 붙이는 인증 사용자. role은 토큰 클레임 값(최대 15분 지연, 계약 5-2). */
export interface AuthUser {
  id: string;
  role: UserRole;
}

export type AuthedRequest = Request & { authUser?: AuthUser };

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.authUser) {
    // JwtGuard 없이 쓴 경우: 프로그래밍 오류
    throw new Error('CurrentUser는 JwtGuard 뒤에서만 쓸 수 있습니다.');
  }
  return req.authUser;
});
