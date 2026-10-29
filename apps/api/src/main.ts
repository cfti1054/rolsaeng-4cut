import 'reflect-metadata';
// .env는 AppModule(JobsModule.forRoot)보다 먼저 읽어야 한다
import './load-env';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { APP_CONFIG, type AppConfig, EnvValidationError, loadConfig } from './config/env';

/**
 * API 서버 진입점. 계약: _workspace/01_architect_contract.md
 * 실행 전 `corepack pnpm -r build`(shared → core → api). 환경 변수는 apps/api/.env 또는 프로세스 환경.
 */
async function bootstrap(): Promise<void> {
  // 필수 환경 변수가 없으면 Nest를 띄우기 전에 멈춘다(계약 10절).
  try {
    loadConfig(process.env);
  } catch (err) {
    if (err instanceof EnvValidationError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const app = await NestFactory.create(AppModule);
  const config = app.get<AppConfig>(APP_CONFIG);
  configureApp(app, config);
  app.enableShutdownHooks();
  await app.listen(config.port);
  new Logger('bootstrap').log(`API listening on :${config.port} (${config.nodeEnv})`);
}

void bootstrap();
