import { Module } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ScrimsModule } from '../scrims/scrims.module';
import { AdminNewsController, NewsController } from './news.controller';
import { NewsService } from './news.service';
import { PATCH_LISTING_FETCH, PatchNoteSyncService, defaultPatchListingFetch } from './patch-note-sync.service';

/**
 * S6 공지·패치노트·이벤트(계약 S6 8절). 게임·사용자 참조는 ScrimViews(같은 직렬화)를 쓴다.
 * ScrimsModule.forRoot()은 AppModule과 같은 객체(인스턴스·cron 중복 없음).
 */
@Module({
  imports: [ScrimsModule.forRoot()],
  controllers: [NewsController, AdminNewsController],
  providers: [NewsService, PatchNoteSyncService, { provide: PATCH_LISTING_FETCH, useValue: defaultPatchListingFetch }, JwtGuard, RolesGuard],
  exports: [NewsService, PatchNoteSyncService],
})
export class NewsModule {}
