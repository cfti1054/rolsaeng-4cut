import { ScheduleModule } from '@nestjs/schedule';

/**
 * 앱 전체가 공유하는 ScheduleModule 동적 모듈 객체 하나.
 * Nest 11은 동적 모듈을 참조로 구분해서 ScheduleModule.forRoot()를 부를 때마다 별도 인스턴스가 생기고,
 * 인스턴스마다 탐색기가 모든 @Cron을 따로 등록해 작업이 그 수만큼 중복 실행된다. forRoot()를 직접 부르지 말고 이 값을 import한다.
 */
export const sharedScheduleModule = ScheduleModule.forRoot();
