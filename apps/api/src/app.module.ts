import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ErrorFilter } from './common/filters/error.filter';
import { ConfigModule } from './config/config.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [ConfigModule, PrismaModule, AuthModule, UsersModule],
  providers: [{ provide: APP_FILTER, useClass: ErrorFilter }],
})
export class AppModule {}
