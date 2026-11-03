import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  AdminIdParams,
  ApiPath,
  ChangeMemberRoleRequest,
  type ChangeMemberRoleResponse,
  CreateApiKeyRequest,
  type CreateApiKeyResponse,
  CreateSeasonRequest,
  type CreateSeasonResponse,
  type GetAdminOverviewResponse,
  type ListAdminApiKeysResponse,
  ListAdminAuditLogsQuery,
  type ListAdminAuditLogsResponse,
  ListAdminMembersQuery,
  type ListAdminMembersResponse,
  ListAdminNoShowScrimsQuery,
  type ListAdminNoShowScrimsResponse,
  ListAdminResultsQuery,
  type ListAdminResultsResponse,
  type ListAdminSeasonsResponse,
  type RevokeApiKeyResponse,
  UpdateSeasonRequest,
  type UpdateSeasonResponse,
} from '@gcd/shared';
import { type AuthUser, CurrentUser } from '../../common/decorators/current-user';
import { Roles } from '../../common/decorators/roles';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { AdminApiKeysService } from './admin-api-keys.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminMembersService } from './admin-members.service';
import { AdminOverviewService } from './admin-overview.service';
import { AdminReviewService } from './admin-review.service';
import { AdminSeasonsService } from './admin-seasons.service';

const idPipe = new ZodValidationPipe(AdminIdParams);

/**
 * S6 관리자 API(계약 S6 4-2, 12절). 클래스 단위 JwtGuard + RolesGuard + @Roles('admin') — 비운영진은 없는 리소스여도 403이 먼저.
 * Authorization: Bearer라 OriginGuard는 붙이지 않는다(쿠키 경로가 아니다). 공지·패치노트·이벤트 쓰기는 news 모듈(AdminNewsController).
 */
@Controller()
@UseGuards(JwtGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(
    private readonly overviewService: AdminOverviewService,
    private readonly review: AdminReviewService,
    private readonly members: AdminMembersService,
    private readonly apiKeys: AdminApiKeysService,
    private readonly seasons: AdminSeasonsService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get(ApiPath.adminOverview)
  overview(@CurrentUser() user: AuthUser): Promise<GetAdminOverviewResponse> {
    return this.overviewService.overview(user);
  }

  @Get(ApiPath.adminResults)
  results(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListAdminResultsQuery)) q: ListAdminResultsQuery,
  ): Promise<ListAdminResultsResponse> {
    return this.review.results(user, q);
  }

  @Get(ApiPath.adminNoShowScrims)
  noShowScrims(
    @Query(new ZodValidationPipe(ListAdminNoShowScrimsQuery)) q: ListAdminNoShowScrimsQuery,
  ): Promise<ListAdminNoShowScrimsResponse> {
    return this.review.noShowScrims(q);
  }

  @Get(ApiPath.adminMembers)
  listMembers(@Query(new ZodValidationPipe(ListAdminMembersQuery)) q: ListAdminMembersQuery): Promise<ListAdminMembersResponse> {
    return this.members.list(q);
  }

  @Patch(ApiPath.adminMemberRole)
  changeRole(
    @CurrentUser() user: AuthUser,
    @Param(idPipe) params: AdminIdParams,
    @Body(new ZodValidationPipe(ChangeMemberRoleRequest)) body: ChangeMemberRoleRequest,
  ): Promise<ChangeMemberRoleResponse> {
    return this.members.changeRole(user, params.id, body);
  }

  @Delete(ApiPath.adminMember)
  @HttpCode(204)
  deleteMember(@CurrentUser() user: AuthUser, @Param(idPipe) params: AdminIdParams): Promise<void> {
    return this.members.remove(user, params.id);
  }

  @Get(ApiPath.adminApiKeys)
  listApiKeys(): Promise<ListAdminApiKeysResponse> {
    return this.apiKeys.list();
  }

  @Post(ApiPath.adminApiKeys)
  @HttpCode(201)
  createApiKey(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateApiKeyRequest)) body: CreateApiKeyRequest,
  ): Promise<CreateApiKeyResponse> {
    return this.apiKeys.create(user, body);
  }

  @Post(ApiPath.adminApiKeyRevoke)
  @HttpCode(200)
  revokeApiKey(@CurrentUser() user: AuthUser, @Param(idPipe) params: AdminIdParams): Promise<RevokeApiKeyResponse> {
    return this.apiKeys.revoke(user, params.id);
  }

  @Get(ApiPath.adminSeasons)
  listSeasons(): Promise<ListAdminSeasonsResponse> {
    return this.seasons.list();
  }

  @Post(ApiPath.adminSeasons)
  @HttpCode(201)
  createSeason(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateSeasonRequest)) body: CreateSeasonRequest,
  ): Promise<CreateSeasonResponse> {
    return this.seasons.create(user, body);
  }

  @Patch(ApiPath.adminSeason)
  updateSeason(
    @CurrentUser() user: AuthUser,
    @Param(idPipe) params: AdminIdParams,
    @Body(new ZodValidationPipe(UpdateSeasonRequest)) body: UpdateSeasonRequest,
  ): Promise<UpdateSeasonResponse> {
    return this.seasons.update(user, params.id, body);
  }

  @Delete(ApiPath.adminSeason)
  @HttpCode(204)
  deleteSeason(@CurrentUser() user: AuthUser, @Param(idPipe) params: AdminIdParams): Promise<void> {
    return this.seasons.remove(user, params.id);
  }

  @Get(ApiPath.adminAuditLogs)
  auditLogs(@Query(new ZodValidationPipe(ListAdminAuditLogsQuery)) q: ListAdminAuditLogsQuery): Promise<ListAdminAuditLogsResponse> {
    return this.audit.list(q);
  }
}
