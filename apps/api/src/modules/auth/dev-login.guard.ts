import { type CanActivate, Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { AppError } from '../../common/app-error';

/**
 * 개발 전용 로그인 열림 조건: AUTH_DEV_LOGIN === 'true' && NODE_ENV !== 'production'(계약 5-8).
 * 닫혀 있으면 라우트가 없는 것과 같은 404 NOT_FOUND. 본문 검증·Origin 검사보다 먼저 실행된다.
 */
@Injectable()
export class DevLoginEnabledGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(): boolean {
    if (!this.config.devLoginEnabled) throw new AppError('NOT_FOUND');
    return true;
  }
}
