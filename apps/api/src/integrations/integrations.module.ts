import { Global, Module } from '@nestjs/common';
import { DATA_DRAGON, RIOT_API, STEAM_API } from './contracts';
import { DataDragonHttp } from './ddragon';
import { INTEGRATION_OPTIONS, type IntegrationOptions, loadIntegrationOptions } from './options';
import { HostRateLimiter } from './rate-limiter';
import { RiotHttpApi } from './riot/riot-client';
import { SteamHttpApi } from './steam/steam-client';

/** RiotApi·SteamApi·DataDragon 실제 구현을 토큰으로 제공한다(backend는 토큰만 주입) */
@Global()
@Module({
  providers: [
    { provide: INTEGRATION_OPTIONS, useFactory: () => loadIntegrationOptions(process.env) },
    {
      provide: RIOT_API,
      inject: [INTEGRATION_OPTIONS],
      useFactory: (o: IntegrationOptions) =>
        new RiotHttpApi(o, new HostRateLimiter(o.ratePerSec, o.ratePer2Min)),
    },
    {
      provide: STEAM_API,
      inject: [INTEGRATION_OPTIONS],
      // 스팀은 버킷 없이 429 일시정지만 쓴다
      useFactory: (o: IntegrationOptions) =>
        new SteamHttpApi(o, new HostRateLimiter(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)),
    },
    { provide: DATA_DRAGON, inject: [INTEGRATION_OPTIONS], useFactory: (o: IntegrationOptions) => new DataDragonHttp(o) },
  ],
  exports: [INTEGRATION_OPTIONS, RIOT_API, STEAM_API, DATA_DRAGON],
})
export class IntegrationsModule {}
