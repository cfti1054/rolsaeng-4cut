import { z } from 'zod';
import { PaginationQuery, paginated } from './common/pagination';
import { IsoDate, IsoDateTime, Uuid } from './common/primitives';
import { CalendarItem } from './calendar';
import { AdminAuditAction, AdminAuditTargetType, ApiKeyScope, ScrimResultStatus, UserRole } from './constants/enums';
import { API_KEY_PATTERN } from './bot';
import {
  NoShowPolicyView,
  ScrimGameRef,
  ScrimOutcome,
  ScrimRatingStatus,
  ScrimResultRevertBlock,
  ScrimUserRef,
} from './scrims';
import { SeasonView } from './seasons';

// =============================================================================
// S6 관리자 도구(문서 2장 운영 「관리자 도구」, 8장 /admin, 목업 Admin). 계약: _workspace/01_architect_contract.md(S6) 4·5절
//
// 모든 /admin/* 엔드포인트는 JwtGuard + RolesGuard + @Roles('admin'). 비운영진은 403 FORBIDDEN(메인 기본값 5).
// 화면의 권한 검사는 보조다. S6부터 JwtGuard는 role을 토큰이 아니라 DB에서 읽는다(D263) — 강등이 즉시 반영된다.
// 쓰기는 모두 같은 트랜잭션에서 admin_audit_logs 1행을 남긴다(10절).
// =============================================================================

// -----------------------------------------------------------------------------
// GET /admin/overview — 통계 카드(목업 Admin 상단 4칸 + 머리 「랭킹 캐시 23:05 갱신」)
// S6 후속(D306): 4번째 칸 = 「다가오는 일정」 목록 카드(upcoming). 칸 1–3 = 승인 대기 · 이번 주 내전 · 이번 달 노쇼
// -----------------------------------------------------------------------------

/** 「다가오는 일정」 카드 최대 행 수(D307) */
export const ADMIN_UPCOMING_MAX = 5;
/** 「다가오는 일정」 조회 기간: 오늘(KST) ~ 오늘 + 이 일수(양 끝 포함, D307) */
export const ADMIN_UPCOMING_DAYS = 30;

/**
 * 「다가오는 일정」(D306–D308). 항목 모양은 GET /calendar 항목(CalendarItem)과 같다 — 공개 범위·필드·직렬화가 같다(D287·D289).
 * - from = 오늘(KST 날짜), to = from + ADMIN_UPCOMING_DAYS일.
 * - 일정: ends_on ≥ from && starts_on ≤ to(진행 중 포함, 날짜 기준). 게임 필터 없음(게임 무관 일정 포함).
 * - 내전: status ≠ cancelled && scheduled_at ≥ now && scheduled_at < (to + 1일) 00:00 KST. my_status는 요청한 운영진 본인.
 * - 순서 = 시작 순(core mergeUpcomingItems): 일정 시작 = starts_on + (start_time ?? 00:00) KST, 내전 시작 = scheduled_at.
 *   같은 시각이면 일정 먼저, 그다음 각 종류 정렬(일정 D302, 내전 scheduled_at·id). 최대 ADMIN_UPCOMING_MAX개.
 * - has_more = 구간 안에 ADMIN_UPCOMING_MAX개보다 많다(화면 「캘린더에서 더 보기」).
 */
export const AdminUpcoming = z.object({
  from: IsoDate,
  to: IsoDate,
  items: z.array(CalendarItem).max(ADMIN_UPCOMING_MAX),
  has_more: z.boolean(),
});
export type AdminUpcoming = z.infer<typeof AdminUpcoming>;

/**
 * 시각 기준은 모두 KST. week_start = 이번 주 월요일 00:00, month_start = 이번 달 1일 00:00(+09:00 표기).
 * - members.total: users 전체, active: left_at null, admins: role admin
 * - scrims_this_week: 홈 stats.scrims_this_week와 같은 정의(scheduled_at이 이번 주, cancelled 아님)
 * - pending_results: scrim_results status pending 수, 가장 오래된 제출 시각(목업 「가장 오래된 제출 · 14시간 전」)
 * - no_shows: no_show_marked_at이 이번 달인 scrim_players 수, 지난달 같은 집계(목업 「지난달보다 2회 적어요」)
 * - restricted_members: 지금 참가 제한 중인 회원 수(core computeScrimRestriction, 서버 노쇼 정책), 가장 빠른 해제 시각
 * - ranking_cache: ranking_caches.computed_at 최댓값(행 없으면 null), last_failed_at이 있는 행 수
 * - restricted_members: 화면 칸에서는 뺐지만(D291) 응답에는 남긴다
 * - upcoming: S6 후속 「다가오는 일정」 카드(AdminUpcoming, D306). 필수(D305 2단계 완료)
 */
export const AdminOverview = z.object({
  generated_at: IsoDateTime,
  week_start: IsoDateTime,
  month_start: IsoDateTime,
  members: z.object({
    total: z.number().int().min(0),
    active: z.number().int().min(0),
    admins: z.number().int().min(0),
  }),
  scrims_this_week: z.number().int().min(0),
  pending_results: z.object({
    count: z.number().int().min(0),
    oldest_submitted_at: IsoDateTime.nullable(),
  }),
  no_shows: z.object({
    this_month: z.number().int().min(0),
    last_month: z.number().int().min(0),
  }),
  restricted_members: z.object({
    count: z.number().int().min(0),
    next_release_at: IsoDateTime.nullable(),
  }),
  ranking_cache: z.object({
    last_computed_at: IsoDateTime.nullable(),
    failing_keys: z.number().int().min(0),
  }),
  upcoming: AdminUpcoming,
});
export type AdminOverview = z.infer<typeof AdminOverview>;
export const GetAdminOverviewResponse = AdminOverview;
export type GetAdminOverviewResponse = z.infer<typeof GetAdminOverviewResponse>;

// -----------------------------------------------------------------------------
// GET /admin/results?view= — 결과 승인 큐(목업 APPROVAL QUEUE). 승인·반려·되돌리기는 기존·S6 /scrims/{id}/result/* 경로를 쓴다
// -----------------------------------------------------------------------------

/**
 * - pending: status pending. 정렬 submitted_at ASC, id ASC(오래된 것부터)
 * - approved: status approved && approved_at ≥ now − SCRIM_RESULT_REVERT_WINDOW_DAYS(되돌리기 후보). approved_at DESC, id DESC
 * (S6 초안의 disputed 보기는 결과 이의 제기와 함께 제거됨, D281)
 */
export const AdminResultView = z.enum(['pending', 'approved']);
export type AdminResultView = z.infer<typeof AdminResultView>;

export const ListAdminResultsQuery = PaginationQuery.extend({
  view: AdminResultView.default('pending'),
});
export type ListAdminResultsQuery = z.infer<typeof ListAdminResultsQuery>;

/** 큐 1행. 상세(참가자·팀·변동)는 /scrims/{id}에서 본다 */
export const AdminResultItem = z.object({
  result_id: Uuid,
  status: ScrimResultStatus,
  scrim: z.object({
    id: Uuid,
    title: z.string(),
    game: ScrimGameRef,
    scheduled_at: IsoDateTime,
    started_at: IsoDateTime.nullable(),
    rated: z.boolean(),
    host: ScrimUserRef,
  }),
  /** 제출된 값(pending도 채운다). 팀 게임 winner_team, 개인 순위 1위 */
  outcome: ScrimOutcome,
  submitted_by: ScrimUserRef,
  submitted_at: IsoDateTime,
  approved_by: ScrimUserRef.nullable(),
  approved_at: IsoDateTime.nullable(),
  rating_status: ScrimRatingStatus,
  /** 요청한 운영진 기준: pending && 제출자가 내가 아님 */
  can_review: z.boolean(),
  /** 요청한 운영진 기준: approved && revert_blocked_reason null */
  can_revert: z.boolean(),
  /** approved일 때 막는 이유(core revertBlockReason, rating_mismatch는 시도 때만 판정이라 여기서는 나오지 않는다). 그 외 null */
  revert_blocked_reason: ScrimResultRevertBlock.nullable(),
});
export type AdminResultItem = z.infer<typeof AdminResultItem>;

export const ListAdminResultsResponse = paginated(AdminResultItem);
export type ListAdminResultsResponse = z.infer<typeof ListAdminResultsResponse>;

// -----------------------------------------------------------------------------
// GET /admin/no-show/scrims — 노쇼 표시 후보(목업 NO-SHOW). 저장은 기존 PUT /scrims/{id}/players/{userId}/no-show를 참가자별로
// -----------------------------------------------------------------------------

/**
 * 후보 내전: status playing·finished && now ≤ scheduled_at + mark_window_days일(노쇼 표시 기한 안, S2 D83).
 * 정렬 scheduled_at DESC, id DESC.
 */
export const ListAdminNoShowScrimsQuery = PaginationQuery;
export type ListAdminNoShowScrimsQuery = z.infer<typeof ListAdminNoShowScrimsQuery>;

/**
 * 참가자 1명(joined·no_show만, 슬롯 순서 = 상세 players와 같음).
 * - no_show_count_30d: (now − window_days, now] 노쇼 수(core computeScrimRestriction.recentCount)
 * - restricted_until: 지금 제한 중이면 해제 시각, 아니면 null
 * - restrict_if_marked: status joined이고, 지금 노쇼로 표시하면 제한이 새로 걸리는가(core previewNoShowRestriction). no_show면 false
 */
export const AdminNoShowPlayer = z.object({
  user: ScrimUserRef,
  status: z.enum(['joined', 'no_show']),
  no_show_count_30d: z.number().int().min(0),
  restricted_until: IsoDateTime.nullable(),
  restrict_if_marked: z.boolean(),
});
export type AdminNoShowPlayer = z.infer<typeof AdminNoShowPlayer>;

export const AdminNoShowScrim = z.object({
  id: Uuid,
  title: z.string(),
  game: ScrimGameRef,
  status: z.enum(['playing', 'finished']),
  scheduled_at: IsoDateTime,
  /** 노쇼 표시 마감 = scheduled_at + mark_window_days일 */
  mark_deadline: IsoDateTime,
  players: z.array(AdminNoShowPlayer),
});
export type AdminNoShowScrim = z.infer<typeof AdminNoShowScrim>;

export const ListAdminNoShowScrimsResponse = paginated(AdminNoShowScrim).extend({
  /** 서버 노쇼 정책(목업 「30일 안에 3회면 7일간 참가 제한」 문구는 이 값으로 만든다, D101) */
  policy: NoShowPolicyView,
});
export type ListAdminNoShowScrimsResponse = z.infer<typeof ListAdminNoShowScrimsResponse>;

// -----------------------------------------------------------------------------
// GET /admin/members · PATCH /admin/members/{id}/role — 멤버 관리(목업 MEMBERS)
// -----------------------------------------------------------------------------

/**
 * 정렬(같으면 id ASC):
 * joined_desc(created_at DESC, 기본), nickname_asc, scrims_desc(scrim_count DESC), no_show_desc(no_show_30d DESC), last_login_desc(null 마지막)
 * 계산 열 정렬이 있어 cursor는 서버가 만든 불투명 오프셋이다(D266). 클라이언트는 해석하지 않는다.
 */
export const AdminMemberSort = z.enum(['joined_desc', 'nickname_asc', 'scrims_desc', 'no_show_desc', 'last_login_desc']);
export type AdminMemberSort = z.infer<typeof AdminMemberSort>;

/** 우선순위 left > restricted > active */
export const AdminMemberStatus = z.enum(['active', 'restricted', 'left']);
export type AdminMemberStatus = z.infer<typeof AdminMemberStatus>;

export const ADMIN_MEMBER_QUERY_MAX_LENGTH = 30;

export const ListAdminMembersQuery = PaginationQuery.extend({
  /** 닉네임 또는 디스코드 username 부분 일치(대소문자 무시). 앞뒤 공백 제거, 빈 문자열이면 조건 없음 */
  q: z
    .string()
    .trim()
    .max(ADMIN_MEMBER_QUERY_MAX_LENGTH)
    .optional()
    .transform((v) => (v ? v : undefined)),
  role: UserRole.optional(),
  sort: AdminMemberSort.default('joined_desc'),
});
export type ListAdminMembersQuery = z.infer<typeof ListAdminMembersQuery>;

/**
 * 멤버 1행.
 * - role_locked: discord_id가 ADMIN_DISCORD_IDS에 있음 → 로그인마다 admin으로 다시 승격되므로 웹 강등 불가(D264)
 * - discord_linked: isLinkedDiscordId(discord_id). discord_username은 디스코드 핸들(웹 응답에 discord_id는 여전히 없다, D38)
 * - scrim_count: 그 회원이 joined인 내전 중 결과가 approved인 수(S5 D239 scrim_count와 같은 정의, 기간 없음)
 * - no_show_30d·restricted_until: 노쇼 후보 화면과 같은 계산
 */
export const AdminMemberItem = z.object({
  user: ScrimUserRef,
  role: UserRole,
  role_locked: z.boolean(),
  discord_linked: z.boolean(),
  discord_username: z.string().nullable(),
  joined_at: IsoDateTime,
  last_login_at: IsoDateTime.nullable(),
  scrim_count: z.number().int().min(0),
  no_show_30d: z.number().int().min(0),
  restricted_until: IsoDateTime.nullable(),
  left_at: IsoDateTime.nullable(),
  status: AdminMemberStatus,
});
export type AdminMemberItem = z.infer<typeof AdminMemberItem>;

export const ListAdminMembersResponse = paginated(AdminMemberItem);
export type ListAdminMembersResponse = z.infer<typeof ListAdminMembersResponse>;

/**
 * 역할 변경(member ↔ admin). 같은 역할이면 변경 없이 200(감사 로그 없음).
 * 오류 판정 순서(core planRoleChange): 자기 자신 → ADMIN_SELF_ROLE_CHANGE(403), 강등 && role_locked → ADMIN_ROLE_LOCKED(409),
 * 강등 && 변경 전 admin 수 ≤ 1 → ADMIN_LAST_ADMIN(409). 요청자가 그사이 강등됐으면 FORBIDDEN(잠금 안에서 DB로 다시 확인).
 */
export const ChangeMemberRoleRequest = z
  .object({
    role: UserRole,
  })
  .strict();
export type ChangeMemberRoleRequest = z.infer<typeof ChangeMemberRoleRequest>;
export const ChangeMemberRoleResponse = AdminMemberItem;
export type ChangeMemberRoleResponse = z.infer<typeof ChangeMemberRoleResponse>;

// -----------------------------------------------------------------------------
// GET·POST /admin/api-keys · POST /admin/api-keys/{id}/revoke — 봇 API 키(S5 D221 CLI의 웹판)
// -----------------------------------------------------------------------------

export const API_KEY_NAME_MIN_LENGTH = 1;
export const API_KEY_NAME_MAX_LENGTH = 40;

/** 원문·해시는 넣지 않는다. created_by null = CLI 발급 */
export const AdminApiKeyItem = z.object({
  id: Uuid,
  name: z.string(),
  key_prefix: z.string(),
  scopes: z.array(ApiKeyScope),
  last_used_at: IsoDateTime.nullable(),
  revoked_at: IsoDateTime.nullable(),
  created_by: ScrimUserRef.nullable(),
  created_at: IsoDateTime,
});
export type AdminApiKeyItem = z.infer<typeof AdminApiKeyItem>;

/**
 * 전체(폐기 포함). 정렬: 폐기 안 된 것 먼저, created_at DESC, id DESC. 페이징 없음(next_cursor 항상 null).
 * DB의 scopes에 지금 ApiKeyScope에 없는 값이 있으면 그 값만 빼고 보여 준다(로그).
 */
export const ListAdminApiKeysResponse = paginated(AdminApiKeyItem);
export type ListAdminApiKeysResponse = z.infer<typeof ListAdminApiKeysResponse>;

export const CreateApiKeyRequest = z
  .object({
    name: z
      .string()
      .transform((v) => v.trim().replace(/\s+/g, ' '))
      .pipe(z.string().min(API_KEY_NAME_MIN_LENGTH).max(API_KEY_NAME_MAX_LENGTH)),
    scopes: z
      .array(ApiKeyScope)
      .min(1)
      .refine((a) => new Set(a).size === a.length, { message: 'scope 중복' }),
  })
  .strict();
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequest>;
export type CreateApiKeyRequestInput = z.input<typeof CreateApiKeyRequest>;

/** 201. key = 원문(이 응답에서 한 번만, 다시 볼 수 없다). 화면은 복사 후 닫으면 지운다 */
export const CreateApiKeyResponse = z.object({
  api_key: AdminApiKeyItem,
  key: z.string().regex(API_KEY_PATTERN),
});
export type CreateApiKeyResponse = z.infer<typeof CreateApiKeyResponse>;

/** 본문 없음. 200 AdminApiKeyItem. 이미 폐기된 키는 그대로 200(revoked_at 유지, 감사 로그 없음). 없으면 NOT_FOUND */
export const RevokeApiKeyResponse = AdminApiKeyItem;
export type RevokeApiKeyResponse = z.infer<typeof RevokeApiKeyResponse>;

// -----------------------------------------------------------------------------
// GET·POST /admin/seasons · PATCH·DELETE /admin/seasons/{id} — 시즌 관리(S4가 미룬 수동 생성·수정, 계약 S6 11절)
// -----------------------------------------------------------------------------

/** 시즌 이름 1–30자(앞뒤 공백 제거·연속 공백 1개) */
export const SEASON_NAME_MAX_LENGTH = 30;
/** 시작 전 시즌의 시작 시각, 진행 중 시즌의 새 끝 시각은 지금 + 이 초 이후여야 한다(승인 트랜잭션·종료 유예보다 충분히 길게, D269) */
export const SEASON_EDIT_MIN_LEAD_SEC = 3600;
export const SEASON_LENGTH_MIN_DAYS = 7;
export const SEASON_LENGTH_MAX_DAYS = 366;

export const SeasonName = z
  .string()
  .transform((v) => v.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1).max(SEASON_NAME_MAX_LENGTH));

/**
 * 시즌 단계(core seasonPhase, now 기준).
 * upcoming: starts_at > now / current: starts_at ≤ now < ends_at / ended: ends_at ≤ now && closed_at null(종료 작업 대기) / closed: closed_at 있음
 */
export const AdminSeasonPhase = z.enum(['upcoming', 'current', 'ended', 'closed']);
export type AdminSeasonPhase = z.infer<typeof AdminSeasonPhase>;

/**
 * 시즌 1행 + 단계·수정 가능 범위(화면이 입력칸을 잠그는 데 쓴다. 서버는 저장 때 다시 검사).
 * editable: name 항상 true / starts_at upcoming만 / ends_at upcoming·current / delete upcoming만
 * rated_games: 그 시즌 rating_history의 서로 다른 scrim_id 수(참고)
 */
export const AdminSeasonItem = SeasonView.extend({
  phase: AdminSeasonPhase,
  closed_at: IsoDateTime.nullable(),
  rated_games: z.number().int().min(0),
  editable: z.object({
    name: z.boolean(),
    starts_at: z.boolean(),
    ends_at: z.boolean(),
    delete: z.boolean(),
  }),
});
export type AdminSeasonItem = z.infer<typeof AdminSeasonItem>;

/** starts_at DESC, id ASC(GET /seasons와 같은 순서). 페이징 없음 */
export const ListAdminSeasonsResponse = paginated(AdminSeasonItem);
export type ListAdminSeasonsResponse = z.infer<typeof ListAdminSeasonsResponse>;

/**
 * POST /admin/seasons — 201 AdminSeasonItem. 규칙(core validateSeasonWrite):
 * starts_at ≥ now + SEASON_EDIT_MIN_LEAD_SEC, 길이 SEASON_LENGTH_MIN_DAYS–MAX_DAYS, 다른 시즌과 겹치지 않음([starts_at, ends_at) 반열림).
 * 위반: 시각·길이 → VALIDATION_FAILED(details path starts_at·ends_at), 겹침 → SEASON_OVERLAP
 */
export const CreateSeasonRequest = z
  .object({
    name: SeasonName,
    starts_at: IsoDateTime,
    ends_at: IsoDateTime,
  })
  .strict();
export type CreateSeasonRequest = z.infer<typeof CreateSeasonRequest>;
export type CreateSeasonRequestInput = z.input<typeof CreateSeasonRequest>;
export const CreateSeasonResponse = AdminSeasonItem;
export type CreateSeasonResponse = z.infer<typeof CreateSeasonResponse>;

/**
 * PATCH /admin/seasons/{id} — 200 AdminSeasonItem. 보낸 필드만 바꾼다(값이 같으면 변경으로 보지 않는다).
 * 단계별 허용(D268): name 항상, starts_at upcoming만, ends_at upcoming·current(current는 새 끝 ≥ now + lead).
 * 허용되지 않는 필드 변경 → SEASON_NOT_EDITABLE
 */
export const UpdateSeasonRequest = z
  .object({
    name: SeasonName,
    starts_at: IsoDateTime,
    ends_at: IsoDateTime,
  })
  .partial()
  .strict()
  .refine((v) => v.name !== undefined || v.starts_at !== undefined || v.ends_at !== undefined, {
    message: '바꿀 필드가 하나 이상 있어야 함',
  });
export type UpdateSeasonRequest = z.infer<typeof UpdateSeasonRequest>;
export type UpdateSeasonRequestInput = z.input<typeof UpdateSeasonRequest>;
export const UpdateSeasonResponse = AdminSeasonItem;
export type UpdateSeasonResponse = z.infer<typeof UpdateSeasonResponse>;

/** DELETE /admin/seasons/{id} — 204. upcoming만(그 외 SEASON_NOT_EDITABLE). 시작 전이라 ratings·이력이 없다 */

// -----------------------------------------------------------------------------
// GET /admin/audit-logs — 운영 감사 기록(계약 S6 10절)
// -----------------------------------------------------------------------------

/** 정렬 created_at DESC, id DESC */
export const ListAdminAuditLogsQuery = PaginationQuery.extend({
  action: AdminAuditAction.optional(),
});
export type ListAdminAuditLogsQuery = z.infer<typeof ListAdminAuditLogsQuery>;

/**
 * 감사 1행. actor null = 그 운영진 행이 지워짐(현재는 회원 삭제 기능이 없어 생기지 않는다).
 * target_id: 대상 행 id(삭제된 대상도 id는 남는다). summary: 서버가 만든 한국어 한 줄(목록 표시용).
 * details: 행위별 전후 값(10-2 표). 화면은 펼쳐 보기로 JSON을 그대로 보여 준다.
 */
export const AdminAuditLogItem = z.object({
  id: Uuid,
  actor: ScrimUserRef.nullable(),
  action: AdminAuditAction,
  target_type: AdminAuditTargetType,
  target_id: Uuid.nullable(),
  summary: z.string(),
  details: z.record(z.string(), z.unknown()),
  created_at: IsoDateTime,
});
export type AdminAuditLogItem = z.infer<typeof AdminAuditLogItem>;

export const ListAdminAuditLogsResponse = paginated(AdminAuditLogItem);
export type ListAdminAuditLogsResponse = z.infer<typeof ListAdminAuditLogsResponse>;

/** 공통 경로 파라미터 `:id`(uuid). 형식이 틀리면 VALIDATION_FAILED(path id) */
export const AdminIdParams = z.object({ id: Uuid });
export type AdminIdParams = z.infer<typeof AdminIdParams>;
