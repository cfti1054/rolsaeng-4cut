import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserRole } from '@gcd/shared';
import type { Request } from 'express';

/** JwtGuard가 요청에 붙이는 인증 사용자. role은 DB 값(S6 D263, 요청마다 읽는다). */
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
