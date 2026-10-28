import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DevLoginEnabledGuard } from './dev-login.guard';
import { DISCORD_OAUTH_CLIENT, FetchDiscordOAuthClient } from './discord-oauth.client';
import { RefreshTokenService } from './refresh-token.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    RefreshTokenService,
    DevLoginEnabledGuard,
    {
      provide: DISCORD_OAUTH_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new FetchDiscordOAuthClient(config),
    },
  ],
  exports: [AuthService, RefreshTokenService],
})
export class AuthModule {}
