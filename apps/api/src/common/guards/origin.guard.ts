import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { AppError } from '../app-error';

/**
 * 쿠키로 인증하는 POST(/auth/refresh, /auth/logout, /auth/dev-login)의 CSRF 방어(계약 5-3 1번).
 * Origin 헤더가 있고 WEB_ORIGIN과 다르면 FORBIDDEN. 헤더가 없으면 통과(SameSite=Lax가 1차 방어).
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const origin = ctx.switchToHttp().getRequest<Request>().headers.origin;
    if (origin === undefined) return true;
    if (origin !== this.config.webOrigin) throw new AppError('FORBIDDEN');
    return true;
  }
}
