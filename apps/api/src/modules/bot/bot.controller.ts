import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  AdminIdParams,
  ApiPath,
  BOT_ENDPOINT_SCOPE,
  type GetBotPendingNoticesResponse,
  type GetBotPendingPatchNotesResponse,
  GetBotRankingParams,
  GetBotRankingQueryByType,
  type GetBotRankingResponse,
  GetBotUpcomingScrimsQuery,
  type GetBotUpcomingScrimsResponse,
  GetBotUserLookupQuery,
  type GetBotUserLookupResponse,
  PostBotActivityRequest,
  type PostBotActivityResponse,
  PostBotDeliveredRequest,
  type PostBotDeliveredResponse,
  PostBotMemberEventsRequest,
  type PostBotMemberEventsResponse,
  PutBotPresenceRequest,
  type PutBotPresenceResponse,
} from '@gcd/shared';
import { AppError } from '../../common/app-error';
import { type BotApiKey, BotScope, CurrentApiKey } from '../../common/decorators/bot-scope.decorator';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { ZodValidationPipe, zodIssuesToDetails } from '../../common/pipes/zod.pipe';
import { z } from 'zod';
import { BotActivityService } from './bot-activity.service';
import { BotAnnouncementsService } from './bot-announcements.service';
import { BotMembersService } from './bot-members.service';
import { BotPresenceService } from './bot-presence.service';
import { type BotRankingRequest, BotQueryService } from './bot-query.service';

/** delivered 본문: 없음(Express 5에서 undefined) 또는 {}. 모르는 필드는 VALIDATION_FAILED */
const deliveredBodyPipe = new ZodValidationPipe(z.preprocess((v) => v ?? {}, PostBotDeliveredRequest));

/**
 * S5 디스코드 봇 API(계약 S5 4-2, 6절). 엔드포인트 6개(`/bot/link`는 없다, D237). `X-API-Key` + 엔드포인트별 scope만 본다.
 * S6: 공지·패치노트 전송 4개(계약 S6 4-3, 8-4). scope는 리소스 단위(bot:notices 2개, bot:patch-notes 2개, D255).
 * JwtGuard·OriginGuard를 거치지 않고 쿠키를 읽지 않는다(서버 대 서버).
 */
@Controller()
@UseGuards(ApiKeyGuard)
export class BotController {
  constructor(
    private readonly activity: BotActivityService,
    private readonly members: BotMembersService,
    private readonly presence: BotPresenceService,
    private readonly query: BotQueryService,
    private readonly announcements: BotAnnouncementsService,
  ) {}

  /** POST /bot/activity → 200 PostBotActivityResponse(건별 결과) */
  @Post(ApiPath.botActivity)
  @HttpCode(200)
  @BotScope(BOT_ENDPOINT_SCOPE.activity)
  recordActivity(
    @CurrentApiKey() key: BotApiKey,
    @Body(new ZodValidationPipe(PostBotActivityRequest)) body: PostBotActivityRequest,
  ): Promise<PostBotActivityResponse> {
    return this.activity.record(body, key.id);
  }

  /** GET /bot/users/lookup?discord_id= → 200 GetBotUserLookupResponse */
  @Get(ApiPath.botUserLookup)
  @BotScope(BOT_ENDPOINT_SCOPE.userLookup)
  lookup(@Query(new ZodValidationPipe(GetBotUserLookupQuery)) q: GetBotUserLookupQuery): Promise<GetBotUserLookupResponse> {
    return this.query.lookup(q.discord_id);
  }

  /** GET /bot/scrims/upcoming?within_min= → 200 GetBotUpcomingScrimsResponse */
  @Get(ApiPath.botUpcomingScrims)
  @BotScope(BOT_ENDPOINT_SCOPE.upcomingScrims)
  upcoming(
    @Query(new ZodValidationPipe(GetBotUpcomingScrimsQuery)) q: GetBotUpcomingScrimsQuery,
  ): Promise<GetBotUpcomingScrimsResponse> {
    return this.query.upcoming(q.within_min);
  }

  /** GET /bot/rankings/:type → 200 GetBotRankingResponse. 쿼리 스키마는 경로 type으로 고른다 */
  @Get(ApiPath.botRanking)
  @BotScope(BOT_ENDPOINT_SCOPE.rankings)
  ranking(
    @Param(new ZodValidationPipe(GetBotRankingParams)) params: GetBotRankingParams,
    @Query() raw: Record<string, unknown>,
  ): Promise<GetBotRankingResponse> {
    const parsed = GetBotRankingQueryByType[params.type].safeParse(raw);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', undefined, { details: zodIssuesToDetails(parsed.error) });
    }
    return this.query.ranking({ type: params.type, query: parsed.data } as BotRankingRequest);
  }

  /** POST /bot/member-events → 200 PostBotMemberEventsResponse(건별 결과) */
  @Post(ApiPath.botMemberEvents)
  @HttpCode(200)
  @BotScope(BOT_ENDPOINT_SCOPE.memberEvents)
  memberEvents(
    @Body(new ZodValidationPipe(PostBotMemberEventsRequest)) body: PostBotMemberEventsRequest,
  ): Promise<PostBotMemberEventsResponse> {
    return this.members.apply(body);
  }

  /** PUT /bot/presence → 200 PutBotPresenceResponse */
  @Put(ApiPath.botPresence)
  @HttpCode(200)
  @BotScope(BOT_ENDPOINT_SCOPE.presence)
  putPresence(
    @CurrentApiKey() key: BotApiKey,
    @Body(new ZodValidationPipe(PutBotPresenceRequest)) body: PutBotPresenceRequest,
  ): Promise<PutBotPresenceResponse> {
    return this.presence.put(body, key.id);
  }

  // ---- S6 공지·패치노트 전송(계약 S6 4-3) ----

  /** GET /bot/notices/pending → 200 GetBotPendingNoticesResponse */
  @Get(ApiPath.botPendingNotices)
  @BotScope(BOT_ENDPOINT_SCOPE.notices)
  pendingNotices(): Promise<GetBotPendingNoticesResponse> {
    return this.announcements.pendingNotices();
  }

  /** POST /bot/notices/:id/delivered {} → 200 PostBotDeliveredResponse(멱등) */
  @Post(ApiPath.botNoticeDelivered)
  @HttpCode(200)
  @BotScope(BOT_ENDPOINT_SCOPE.notices)
  noticeDelivered(
    @Param(new ZodValidationPipe(AdminIdParams)) params: AdminIdParams,
    @Body(deliveredBodyPipe) _body: PostBotDeliveredRequest,
  ): Promise<PostBotDeliveredResponse> {
    return this.announcements.noticeDelivered(params.id);
  }

  /** GET /bot/patch-notes/pending → 200 GetBotPendingPatchNotesResponse */
  @Get(ApiPath.botPendingPatchNotes)
  @BotScope(BOT_ENDPOINT_SCOPE.patchNotes)
  pendingPatchNotes(): Promise<GetBotPendingPatchNotesResponse> {
    return this.announcements.pendingPatchNotes();
  }

  /** POST /bot/patch-notes/:id/delivered {} → 200 PostBotDeliveredResponse(멱등) */
  @Post(ApiPath.botPatchNoteDelivered)
  @HttpCode(200)
  @BotScope(BOT_ENDPOINT_SCOPE.patchNotes)
  patchNoteDelivered(
    @Param(new ZodValidationPipe(AdminIdParams)) params: AdminIdParams,
    @Body(deliveredBodyPipe) _body: PostBotDeliveredRequest,
  ): Promise<PostBotDeliveredResponse> {
    return this.announcements.patchNoteDelivered(params.id);
  }
}
