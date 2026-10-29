import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ClockModule } from './common/clock';
import { ErrorFilter } from './common/filters/error.filter';
import { ConfigModule } from './config/config.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { JobsModule } from './jobs/jobs.module';
import { AuthModule } from './modules/auth/auth.module';
import { GameAccountsModule } from './modules/game-accounts/game-accounts.module';
import { GamesModule } from './modules/games/games.module';
import { ProfileModule } from './modules/profile/profile.module';
import { ScrimsModule } from './modules/scrims/scrims.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';

/**
 * JobsModule.forRoot()·ScrimsModule.forRoot()은 이 파일을 읽는 시점의 process.env(REDIS_URL, SYNC_JOBS_ENABLED,
 * SCRIM_JOBS_ENABLED)로 구성된다.
 * main.ts는 이 파일보다 먼저 load-env로 .env를 읽는다.
 */
@Module({
  imports: [
    ConfigModule,
    ClockModule,
    PrismaModule,
    IntegrationsModule,
    JobsModule.forRoot(),
    AuthModule,
    UsersModule,
    GameAccountsModule,
    ProfileModule,
    GamesModule,
    ScrimsModule.forRoot(),
  ],
  providers: [{ provide: APP_FILTER, useClass: ErrorFilter }],
})
export class AppModule {}
