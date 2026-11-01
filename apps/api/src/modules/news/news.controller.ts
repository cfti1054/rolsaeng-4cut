import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  AdminIdParams,
  ApiPath,
  CreateEventRequest,
  type CreateEventResponse,
  CreateNoticeRequest,
  type CreateNoticeResponse,
  CreatePatchNoteRequest,
  type CreatePatchNoteResponse,
  ListEventsQuery,
  type ListEventsResponse,
  ListNoticesQuery,
  type ListNoticesResponse,
  ListPatchNotesQuery,
  type ListPatchNotesResponse,
  UpdateEventRequest,
  type UpdateEventResponse,
  UpdateNoticeRequest,
  type UpdateNoticeResponse,
  UpdatePatchNoteRequest,
  type UpdatePatchNoteResponse,
} from '@gcd/shared';
import { type AuthUser, CurrentUser } from '../../common/decorators/current-user';
import { Roles } from '../../common/decorators/roles';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { NewsService } from './news.service';

const idPipe = new ZodValidationPipe(AdminIdParams);

/** S6 공개 읽기(계약 S6 4-1). 로그인 회원 전원 */
@Controller()
@UseGuards(JwtGuard)
export class NewsController {
  constructor(private readonly news: NewsService) {}

  /** GET /notices → 200 ListNoticesResponse */
  @Get(ApiPath.notices)
  notices(@Query(new ZodValidationPipe(ListNoticesQuery)) q: ListNoticesQuery): Promise<ListNoticesResponse> {
    return this.news.listNotices(q);
  }

  /** GET /patch-notes?game= → 200 ListPatchNotesResponse */
  @Get(ApiPath.patchNotes)
  patchNotes(@Query(new ZodValidationPipe(ListPatchNotesQuery)) q: ListPatchNotesQuery): Promise<ListPatchNotesResponse> {
    return this.news.listPatchNotes(q);
  }

  /** GET /events?from=&to=&game= → 200 ListEventsResponse */
  @Get(ApiPath.events)
  events(@Query(new ZodValidationPipe(ListEventsQuery)) q: ListEventsQuery): Promise<ListEventsResponse> {
    return this.news.listEvents(q);
  }
}

/** S6 운영진 공지·패치노트·이벤트 쓰기(계약 S6 4-2). 클래스 단위 @Roles('admin') — 없는 id도 403이 먼저 */
@Controller()
@UseGuards(JwtGuard, RolesGuard)
@Roles('admin')
export class AdminNewsController {
  constructor(private readonly news: NewsService) {}

  @Post(ApiPath.adminNotices)
  @HttpCode(201)
  createNotice(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateNoticeRequest)) body: CreateNoticeRequest,
  ): Promise<CreateNoticeResponse> {
    return this.news.createNotice(user, body);
  }

  @Patch(ApiPath.adminNotice)
  updateNotice(
    @CurrentUser() user: AuthUser,
    @Param(idPipe) params: AdminIdParams,
    @Body(new ZodValidationPipe(UpdateNoticeRequest)) body: UpdateNoticeRequest,
  ): Promise<UpdateNoticeResponse> {
    return this.news.updateNotice(user, params.id, body);
  }

  @Delete(ApiPath.adminNotice)
  @HttpCode(204)
  deleteNotice(@CurrentUser() user: AuthUser, @Param(idPipe) params: AdminIdParams): Promise<void> {
    return this.news.deleteNotice(user, params.id);
  }

  @Post(ApiPath.adminPatchNotes)
  @HttpCode(201)
  createPatchNote(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreatePatchNoteRequest)) body: CreatePatchNoteRequest,
  ): Promise<CreatePatchNoteResponse> {
    return this.news.createPatchNote(user, body);
  }

  @Patch(ApiPath.adminPatchNote)
  updatePatchNote(
    @CurrentUser() user: AuthUser,
    @Param(idPipe) params: AdminIdParams,
    @Body(new ZodValidationPipe(UpdatePatchNoteRequest)) body: UpdatePatchNoteRequest,
  ): Promise<UpdatePatchNoteResponse> {
    return this.news.updatePatchNote(user, params.id, body);
  }

  @Delete(ApiPath.adminPatchNote)
  @HttpCode(204)
  deletePatchNote(@CurrentUser() user: AuthUser, @Param(idPipe) params: AdminIdParams): Promise<void> {
    return this.news.deletePatchNote(user, params.id);
  }

  @Post(ApiPath.adminEvents)
  @HttpCode(201)
  createEvent(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateEventRequest)) body: CreateEventRequest,
  ): Promise<CreateEventResponse> {
    return this.news.createEvent(user, body);
  }

  @Patch(ApiPath.adminEvent)
  updateEvent(
    @CurrentUser() user: AuthUser,
    @Param(idPipe) params: AdminIdParams,
    @Body(new ZodValidationPipe(UpdateEventRequest)) body: UpdateEventRequest,
  ): Promise<UpdateEventResponse> {
    return this.news.updateEvent(user, params.id, body);
  }

  @Delete(ApiPath.adminEvent)
  @HttpCode(204)
  deleteEvent(@CurrentUser() user: AuthUser, @Param(idPipe) params: AdminIdParams): Promise<void> {
    return this.news.deleteEvent(user, params.id);
  }
}
