import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  ApiPath,
  ApproveScrimResultRequest,
  type ApproveScrimResultResponse,
  BalanceScrimRequest,
  type BalanceScrimResponse,
  type CancelScrimResponse,
  CreateScrimRequest,
  type CreateScrimResponse,
  type GetMyScrimRestrictionResponse,
  type GetScrimResponse,
  IdParam,
  JoinScrimRequest,
  type JoinScrimResponse,
  type LeaveScrimResponse,
  RejectScrimResultRequest,
  type RejectScrimResultResponse,
  SaveScrimTeamsRequest,
  type SaveScrimTeamsResponse,
  SubmitScrimResultRequest,
  type SubmitScrimResultResponse,
  type WithdrawScrimResultResponse,
  ListScrimsQuery,
  type ListScrimsResponse,
  SetScrimNoShowParams,
  SetScrimNoShowRequest,
  type SetScrimNoShowResponse,
  type StartScrimResponse,
  UpdateScrimRequest,
  type UpdateScrimResponse,
} from '@gcd/shared';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../../common/decorators/current-user';
import { Roles } from '../../common/decorators/roles';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { ScrimRestrictionService } from './scrim-restriction.service';
import { ScrimResultsService } from './scrim-results.service';
import { ScrimTeamsService } from './scrim-teams.service';
import { ScrimsService } from './scrims.service';

const idPipe = new ZodValidationPipe(IdParam);
/** 밸런스 본문: 없음(Express 5에서 undefined) 또는 {} */
const balanceBodyPipe = new ZodValidationPipe(z.preprocess((v) => v ?? {}, BalanceScrimRequest));

/**
 * 내전(계약 S2 4절, S3 4절). 모두 JWT. 노쇼 표시·결과 승인·반려는 운영진(@Roles('admin') — FORBIDDEN이 NOT_FOUND보다 먼저).
 */
@Controller()
@UseGuards(JwtGuard)
export class ScrimsController {
  constructor(
    private readonly scrims: ScrimsService,
    private readonly restriction: ScrimRestrictionService,
    private readonly teams: ScrimTeamsService,
    private readonly results: ScrimResultsService,
  ) {}

  /** GET /scrims → 200 ListScrimsResponse */
  @Get(ApiPath.scrims)
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListScrimsQuery)) query: ListScrimsQuery,
  ): Promise<ListScrimsResponse> {
    return this.scrims.list(user, query);
  }

  /** POST /scrims → 201 CreateScrimResponse */
  @Post(ApiPath.scrims)
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateScrimRequest)) body: CreateScrimRequest,
  ): Promise<CreateScrimResponse> {
    return this.scrims.create(user, body);
  }

  /** GET /scrims/:id → 200 GetScrimResponse */
  @Get(ApiPath.scrim)
  get(@CurrentUser() user: AuthUser, @Param(idPipe) params: IdParam): Promise<GetScrimResponse> {
    return this.scrims.get(user, params.id);
  }

  /** PATCH /scrims/:id → 200 UpdateScrimResponse (방장) */
  @Patch(ApiPath.scrim)
  update(
    @CurrentUser() user: AuthUser,
    @Param(idPipe) params: IdParam,
    @Body(new ZodValidationPipe(UpdateScrimRequest)) body: UpdateScrimRequest,
  ): Promise<UpdateScrimResponse> {
    return this.scrims.update(user, params.id, body);
  }

  /** POST /scrims/:id/join → 200 JoinScrimResponse (참가·대기 등록·희망 포지션 변경) */
  @Post(ApiPath.scrimJoin)
  @HttpCode(200)
  join(
    @CurrentUser() user: AuthUser,
    @Param(idPipe) params: IdParam,
    @Body(new ZodValidationPipe(JoinScrimRequest)) body: JoinScrimRequest,
  ): Promise<JoinScrimResponse> {
    return this.scrims.join(user, params.id, body);
  }

  /** DELETE /scrims/:id/join → 200 LeaveScrimResponse */
  @Delete(ApiPath.scrimJoin)
  @HttpCode(200)
  leave(@CurrentUser() user: AuthUser, @Param(idPipe) params: IdParam): Promise<LeaveScrimResponse> {
    return this.scrims.leave(user, params.id);
  }

  /** POST /scrims/:id/start → 200 StartScrimResponse (방장·운영진) */
  @Post(ApiPath.scrimStart)
  @HttpCode(200)
  start(@CurrentUser() user: AuthUser, @Param(idPipe) params: IdParam): Promise<StartScrimResponse> {
    return this.scrims.start(user, params.id);
  }

  /** POST /scrims/:id/cancel → 200 CancelScrimResponse (방장·운영진) */
  @Post(ApiPath.scrimCancel)
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param(idPipe) params: IdParam): Promise<CancelScrimResponse> {
    return this.scrims.cancel(user, params.id);
  }

  /** PUT /scrims/:id/players/:userId/no-show → 200 SetScrimNoShowResponse (운영진) */
  @Put(ApiPath.scrimPlayerNoShow)
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles('admin')
  setNoShow(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(SetScrimNoShowParams)) params: SetScrimNoShowParams,
    @Body(new ZodValidationPipe(SetScrimNoShowRequest)) body: SetScrimNoShowRequest,
  ): Promise<SetScrimNoShowResponse> {
    return this.scrims.setNoShow(user, params.id, params.userId, body);
  }

  // ---- S3 팀 구성·결과(계약 S3 4·5절) ----

  /** POST /scrims/:id/balance → 200 BalanceScrimResponse (방장·운영진, 계산만) */
  @Post(ApiPath.scrimBalance)
  @HttpCode(200)
  balance(
    @CurrentUser() user: AuthUser,
    @Param(idPipe) params: IdParam,
    @Body(balanceBodyPipe) _body: BalanceScrimRequest,
  ): Promise<BalanceScrimResponse> {
    return this.teams.balance(user, params.id);
  }

  /** PUT /scrims/:id/teams → 200 SaveScrimTeamsResponse (방장·운영진) */
  @Put(ApiPath.scrimTeams)
  @HttpCode(200)
  saveTeams(
    @CurrentUser() user: AuthUser,
    @Param(idPipe) params: IdParam,
    @Body(new ZodValidationPipe(SaveScrimTeamsRequest)) body: SaveScrimTeamsRequest,
  ): Promise<SaveScrimTeamsResponse> {
    return this.teams.saveTeams(user, params.id, body);
  }

  /** POST /scrims/:id/result → 200 SubmitScrimResultResponse (방장·운영진) */
  @Post(ApiPath.scrimResult)
  @HttpCode(200)
  submitResult(
    @CurrentUser() user: AuthUser,
    @Param(idPipe) params: IdParam,
    @Body(new ZodValidationPipe(SubmitScrimResultRequest)) body: SubmitScrimResultRequest,
  ): Promise<SubmitScrimResultResponse> {
    return this.results.submit(user, params.id, body);
  }

  /** DELETE /scrims/:id/result → 200 WithdrawScrimResultResponse (제출자·방장) */
  @Delete(ApiPath.scrimResult)
  @HttpCode(200)
  withdrawResult(@CurrentUser() user: AuthUser, @Param(idPipe) params: IdParam): Promise<WithdrawScrimResultResponse> {
    return this.results.withdraw(user, params.id);
  }

  /** POST /scrims/:id/result/approve → 200 ApproveScrimResultResponse (운영진, 자기 제출 제외) */
  @Post(ApiPath.scrimResultApprove)
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles('admin')
  approveResult(
    @CurrentUser() user: AuthUser,
    @Param(idPipe) params: IdParam,
    @Body(new ZodValidationPipe(ApproveScrimResultRequest)) body: ApproveScrimResultRequest,
  ): Promise<ApproveScrimResultResponse> {
    return this.results.approve(user, params.id, body);
  }

  /** POST /scrims/:id/result/reject → 200 RejectScrimResultResponse (운영진, 자기 제출 제외) */
  @Post(ApiPath.scrimResultReject)
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles('admin')
  rejectResult(
    @CurrentUser() user: AuthUser,
    @Param(idPipe) params: IdParam,
    @Body(new ZodValidationPipe(RejectScrimResultRequest)) body: RejectScrimResultRequest,
  ): Promise<RejectScrimResultResponse> {
    return this.results.reject(user, params.id, body);
  }

  /** GET /me/scrim-restriction → 200 GetMyScrimRestrictionResponse */
  @Get(ApiPath.myScrimRestriction)
  myRestriction(@CurrentUser() user: AuthUser): Promise<GetMyScrimRestrictionResponse> {
    return this.restriction.getMine(user.id);
  }
}
