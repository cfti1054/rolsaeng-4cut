import { Global, Module } from '@nestjs/common';

/**
 * 현재 시각 공급자. 서비스는 `new Date()` 대신 이것을 주입받아 쓴다(테스트가 시각을 고정·이동할 수 있게).
 * 소유 확인 만료·5초 간격·KST 하루 경계·6시간 캐시 판단에 쓴다.
 */
export interface Clock {
  now(): Date;
}

export const APP_CLOCK = Symbol('APP_CLOCK');

export const systemClock: Clock = { now: () => new Date() };

@Global()
@Module({
  providers: [{ provide: APP_CLOCK, useValue: systemClock }],
  exports: [APP_CLOCK],
})
export class ClockModule {}
