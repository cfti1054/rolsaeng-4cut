import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  ApiPath,
  BOT_ENDPOINT_SCOPE,
  GetBotRankingParams,
  GetBotRankingQueryByType,
  type GetBotRankingResponse,
  GetBotUpcomingScrimsQuery,
  type GetBotUpcomingScrimsResponse,
  GetBotUserLookupQuery,
  type GetBotUserLookupResponse,
  PostBotActivityRequest,
  type PostBotActivityResponse,
  PostBotMemberEventsRequest,
  type PostBotMemberEventsResponse,
  PutBotPresenceRequest,
  type PutBotPresenceResponse,
} from '@gcd/shared';
import { AppError } from '../../common/app-error';
import { type BotApiKey, BotScope, CurrentApiKey } from '../../common/decorators/bot-scope.decorator';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { ZodValidationPipe, zodIssuesToDetails } from '../../common/pipes/zod.pipe';
import { BotActivityService } from './bot-activity.service';
import { BotMembersService } from './bot-members.service';
import { BotPresenceService } from './bot-presence.service';
import { type BotRankingRequest, BotQueryService } from './bot-query.service';

/**
 * S5 디스코드 봇 API(계약 S5 4-2, 6절). 엔드포인트 6개(`/bot/link`는 없다, D237). `X-API-Key` + 엔드포인트별 scope만 본다.
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
}
