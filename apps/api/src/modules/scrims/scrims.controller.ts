import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  ApiPath,
  type CancelScrimResponse,
  CreateScrimRequest,
  type CreateScrimResponse,
  type GetMyScrimRestrictionResponse,
  type GetScrimResponse,
  IdParam,
  JoinScrimRequest,
  type JoinScrimResponse,
  type LeaveScrimResponse,
  ListScrimsQuery,
  type ListScrimsResponse,
  SetScrimNoShowParams,
  SetScrimNoShowRequest,
  type SetScrimNoShowResponse,
  type StartScrimResponse,
  UpdateScrimRequest,
  type UpdateScrimResponse,
} from '@gcd/shared';
import { type AuthUser, CurrentUser } from '../../common/decorators/current-user';
import { Roles } from '../../common/decorators/roles';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { ScrimRestrictionService } from './scrim-restriction.service';
import { ScrimsService } from './scrims.service';

const idPipe = new ZodValidationPipe(IdParam);

/** 내전(계약 S2 4절). 모두 JWT. 노쇼 표시만 운영진(@Roles('admin') — FORBIDDEN이 NOT_FOUND보다 먼저) */
@Controller()
@UseGuards(JwtGuard)
export class ScrimsController {
  constructor(
    private readonly scrims: ScrimsService,
    private readonly restriction: ScrimRestrictionService,
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

  /** GET /me/scrim-restriction → 200 GetMyScrimRestrictionResponse */
  @Get(ApiPath.myScrimRestriction)
  myRestriction(@CurrentUser() user: AuthUser): Promise<GetMyScrimRestrictionResponse> {
    return this.restriction.getMine(user.id);
  }
}
