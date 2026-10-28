import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { API_PREFIX } from '@gcd/shared';
import cookieParser from 'cookie-parser';
import type { AppConfig } from './config/env';

/** main.ts와 테스트가 같은 설정을 쓰도록 앱 공통 설정을 한 곳에 둔다. */
export function configureApp(app: INestApplication, config: AppConfig): void {
  const express = app as NestExpressApplication;
  express.disable('x-powered-by');
  // 전역 접두사: 모든 라우트는 /api/v1 아래(계약 3절). 경로 상수는 shared ApiPath.
  app.setGlobalPrefix(API_PREFIX.replace(/^\//, ''));
  app.use(cookieParser(config.cookieSecret));
  // CORS는 열지 않는다(계약 5-1: 웹 오리진 프록시).
}
