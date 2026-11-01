import { Module } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { NewsModule } from '../news/news.module';
import { ScrimsModule } from '../scrims/scrims.module';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

/**
 * S6 후속 커뮤니티 캘린더(계약 S6 23절, D282–D297). 읽기 GET /calendar 하나.
 * 내전 카드는 ScrimViews.summaries, 운영진 일정은 NewsService.eventViews를 그대로 쓴다(직렬화 한 벌).
 * 일정 쓰기는 기존 /admin/events…(NewsModule)를 재사용한다(D284). ScrimsModule.forRoot()은 AppModule과 같은 객체.
 */
@Module({
  imports: [ScrimsModule.forRoot(), NewsModule],
  controllers: [CalendarController],
  providers: [CalendarService, JwtGuard],
  // S6 후속(23-8-4): AdminOverviewService가 「다가오는 일정」에 쓴다. CalendarModule은 AdminModule을 import하지 않는다(순환 없음)
  exports: [CalendarService],
})
export class CalendarModule {}
