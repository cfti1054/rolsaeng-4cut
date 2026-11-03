import { describe, expect, it } from 'vitest';
import {
  ADMIN_AUDIT_TARGET_BY_ACTION,
  AdminAuditAction,
  AdminAuditLogItem,
  AdminAuditTargetType,
  AdminResultItem,
  AdminSeasonItem,
  ApiKeyScope,
  ApiPath,
  BOT_ENDPOINT_SCOPE,
  ChangeMemberRoleRequest,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  CreateEventRequest,
  CreateNoticeRequest,
  CreatePatchNoteRequest,
  CreateSeasonRequest,
  DashboardNews,
  ERROR_HTTP_STATUS,
  EVENTS_RANGE_MAX_DAYS,
  ErrorCode,
  ExternalUrl,
  GetBotPendingNoticesResponse,
  GetBotPendingPatchNotesResponse,
  GetDashboardSummaryResponse,
  IsoDate,
  ListAdminMembersQuery,
  ListAdminResultsQuery,
  ListEventsQuery,
  ListEventsResponse,
  ListNoticesResponse,
  NOTICE_BODY_MAX_LENGTH,
  NotificationSettings,
  PostBotDeliveredRequest,
  PostBotDeliveredResponse,
  RevertScrimResultRequest,
  SCRIM_RESULT_STATUS_TRANSITIONS,
  SCRIM_STATUS_TRANSITIONS,
  ScrimResultRevertBlock,
  ScrimResultStatus,
  UpdateEventRequest,
  UpdateMyNotificationSettingsRequest,
  UpdateNoticeRequest,
  UpdateSeasonRequest,
  canTransition,
  fillPath,
  isoDateDiffDays,
} from './index';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const T = '2026-10-31T12:00:00.000Z';
const SNOW = '123456789012345678';
const user = { id: ID, nickname: '새벽감자', avatar_url: null };
const lol = { code: 'lol', name: '리그 오브 레전드', has_positions: true, has_teams: true, has_results: true, positions: ['top'] } as const;

describe('S6 경로', () => {
  it('새 경로 26개(이의 제기 3개 제거, D281, 회원 삭제 1개 추가)', () => {
    const expected: Record<string, string> = {
      scrimResultRevert: '/scrims/:id/result/revert',
      myNotificationSettings: '/me/notification-settings',
      notices: '/notices',
      patchNotes: '/patch-notes',
      events: '/events',
      adminOverview: '/admin/overview',
      adminResults: '/admin/results',
      adminNoShowScrims: '/admin/no-show/scrims',
      adminMembers: '/admin/members',
      adminMemberRole: '/admin/members/:id/role',
      adminMember: '/admin/members/:id',
      adminNotices: '/admin/notices',
      adminNotice: '/admin/notices/:id',
      adminPatchNotes: '/admin/patch-notes',
      adminPatchNote: '/admin/patch-notes/:id',
      adminEvents: '/admin/events',
      adminEvent: '/admin/events/:id',
      adminApiKeys: '/admin/api-keys',
      adminApiKeyRevoke: '/admin/api-keys/:id/revoke',
      adminSeasons: '/admin/seasons',
      adminSeason: '/admin/seasons/:id',
      adminAuditLogs: '/admin/audit-logs',
      botPendingNotices: '/bot/notices/pending',
      botNoticeDelivered: '/bot/notices/:id/delivered',
      botPendingPatchNotes: '/bot/patch-notes/pending',
      botPatchNoteDelivered: '/bot/patch-notes/:id/delivered',
    };
    for (const [k, v] of Object.entries(expected)) expect((ApiPath as Record<string, string>)[k], k).toBe(v);
    expect(Object.keys(expected)).toHaveLength(26);
    // 결과 이의 제기 경로는 없다(D281)
    for (const k of ['scrimResultDisputes', 'adminDisputes', 'adminDisputeResolve']) expect(k in ApiPath, k).toBe(false);
    for (const v of Object.values(ApiPath)) expect(v.includes('dispute'), v).toBe(false);
    expect(fillPath(ApiPath.scrimResultRevert, { id: ID })).toBe(`/scrims/${ID}/result/revert`);
    // 경로 값은 서로 다르다(같은 경로 + 다른 메서드는 한 키로 쓴다)
    const values = Object.values(ApiPath);
    expect(new Set(values).size).toBe(values.length);
  });
  it('관리자 경로는 모두 /admin 아래, 봇 경로는 /bot 아래', () => {
    for (const [k, v] of Object.entries(ApiPath)) {
      if (k.startsWith('admin')) expect(v.startsWith('/admin/'), k).toBe(true);
      if (k.startsWith('bot')) expect(v.startsWith('/bot/'), k).toBe(true);
    }
  });
});

describe('S6 오류 코드·scope', () => {
  it('오류 코드 10개 추가(전체 56개, 이의 제기 3개 제거 D281, 회원 삭제 2개 추가), 상태 표 일치', () => {
    const s6 = {
      SCRIM_RESULT_NOT_APPROVED: 409,
      SCRIM_RESULT_REVERT_NOT_ALLOWED: 409,
      ADMIN_SELF_ROLE_CHANGE: 403,
      ADMIN_ROLE_LOCKED: 409,
      ADMIN_LAST_ADMIN: 409,
      SEASON_NOT_EDITABLE: 409,
      SEASON_OVERLAP: 409,
      DISCORD_ALREADY_NOTIFIED: 409,
      ADMIN_DELETE_ADMIN: 409,
      ADMIN_MEMBER_HAS_HISTORY: 409,
    } as const;
    for (const [c, status] of Object.entries(s6)) {
      expect(ErrorCode.options).toContain(c);
      expect(ERROR_HTTP_STATUS[c as ErrorCode]).toBe(status);
    }
    expect(ErrorCode.options).toHaveLength(56);
    for (const c of ['SCRIM_DISPUTE_NOT_ALLOWED', 'SCRIM_DISPUTE_EXISTS', 'DISPUTE_ALREADY_RESOLVED']) {
      expect(ErrorCode.options as readonly string[]).not.toContain(c);
    }
    expect(Object.keys(ERROR_HTTP_STATUS).sort()).toEqual([...ErrorCode.options].sort());
  });
  it('scope 8개 = BOT_ENDPOINT_SCOPE 값과 1:1(리소스 단위, D255)', () => {
    expect(ApiKeyScope.options).toHaveLength(8);
    expect(BOT_ENDPOINT_SCOPE.notices).toBe('bot:notices');
    expect(BOT_ENDPOINT_SCOPE.patchNotes).toBe('bot:patch-notes');
    const vals = Object.values(BOT_ENDPOINT_SCOPE);
    expect(new Set(vals).size).toBe(vals.length);
    expect([...ApiKeyScope.options].sort()).toEqual([...vals].sort());
  });
});

describe('S6 상태 전이', () => {
  it('결과 approved → reverted, reverted 종착, 내전 finished → playing', () => {
    expect(ScrimResultStatus.options).toContain('reverted');
    expect(canTransition(SCRIM_RESULT_STATUS_TRANSITIONS, 'approved', 'reverted')).toBe(true);
    expect(SCRIM_RESULT_STATUS_TRANSITIONS.reverted).toEqual([]);
    expect(canTransition(SCRIM_RESULT_STATUS_TRANSITIONS, 'pending', 'reverted')).toBe(false);
    expect(canTransition(SCRIM_RESULT_STATUS_TRANSITIONS, 'reverted', 'approved')).toBe(false);
    expect(canTransition(SCRIM_STATUS_TRANSITIONS, 'finished', 'playing')).toBe(true);
    expect(canTransition(SCRIM_STATUS_TRANSITIONS, 'finished', 'recruiting')).toBe(false);
    expect(canTransition(SCRIM_STATUS_TRANSITIONS, 'cancelled', 'playing')).toBe(false);
  });
});

describe('S6 결과 되돌리기', () => {
  it('되돌리기 사유 정규화·길이·strict', () => {
    expect(RevertScrimResultRequest.parse({ result_id: ID, reason: '  승패가\n 반대로  입력됨 ' }).reason).toBe('승패가 반대로 입력됨');
    expect(RevertScrimResultRequest.safeParse({ result_id: ID, reason: ' a ' }).success).toBe(false);
    expect(RevertScrimResultRequest.safeParse({ result_id: ID, reason: 'x'.repeat(201) }).success).toBe(false);
    expect(RevertScrimResultRequest.safeParse({ result_id: ID }).success).toBe(false);
    expect(RevertScrimResultRequest.safeParse({ result_id: ID, reason: '잘못 입력', force: true }).success).toBe(false);
  });
  it('막는 이유 enum 순서(우선순위)', () => {
    expect(ScrimResultRevertBlock.options).toEqual([
      'self_submitted',
      'window_passed',
      'season_closed',
      'later_games',
      'rating_mismatch',
    ]);
  });
  it('승인 큐 행', () => {
    const item = {
      result_id: ID,
      status: 'approved',
      scrim: { id: ID2, title: '일요일 협곡 내전', game: lol, scheduled_at: T, started_at: T, rated: true, host: user },
      outcome: { winner_team: 'blue', winner: null },
      submitted_by: user,
      submitted_at: T,
      approved_by: user,
      approved_at: T,
      rating_status: 'applied',
      can_review: false,
      can_revert: false,
      revert_blocked_reason: 'later_games',
    };
    expect(AdminResultItem.parse(item).revert_blocked_reason).toBe('later_games');
    expect(AdminResultItem.safeParse({ ...item, status: 'reverted', revert_blocked_reason: null }).success).toBe(true);
    expect(ListAdminResultsQuery.parse({}).view).toBe('pending');
    expect(ListAdminResultsQuery.safeParse({ view: 'all' }).success).toBe(false);
    expect(ListAdminResultsQuery.safeParse({ view: 'disputed' }).success).toBe(false);
    // 이의 제기 수 필드는 없다(D281). 객체 스키마라 모르는 필드는 버린다
    expect('open_dispute_count' in AdminResultItem.parse({ ...item, open_dispute_count: 1 })).toBe(false);
  });
});

describe('S6 날짜·링크', () => {
  it('IsoDate는 실제 날짜만', () => {
    expect(IsoDate.safeParse('2026-10-31').success).toBe(true);
    expect(IsoDate.safeParse('2026-02-30').success).toBe(false);
    expect(IsoDate.safeParse('2026-1-5').success).toBe(false);
    expect(IsoDate.safeParse('2026-10-31T00:00:00Z').success).toBe(false);
    expect(isoDateDiffDays('2026-10-31', '2026-11-02')).toBe(2);
    expect(isoDateDiffDays('2026-03-01', '2026-02-28')).toBe(-1);
  });
  it('ExternalUrl은 http·https만', () => {
    expect(ExternalUrl.parse(' https://www.leagueoflegends.com/ko-kr/news/ ')).toBe('https://www.leagueoflegends.com/ko-kr/news/');
    expect(ExternalUrl.safeParse('javascript:alert(1)').success).toBe(false);
    expect(ExternalUrl.safeParse('ftp://example.com/a').success).toBe(false);
    expect(ExternalUrl.safeParse('https://e.com/' + 'a'.repeat(500)).success).toBe(false);
  });
});

describe('S6 공지·패치노트·이벤트', () => {
  it('공지 작성: 제목 한 줄 정규화, 본문 줄바꿈 유지, notify_discord 기본 false', () => {
    const r = CreateNoticeRequest.parse({ title: '  11월 내전  일정 ', body: '첫 줄  \r\n\r\n둘째 줄 \n' });
    expect(r).toEqual({ title: '11월 내전 일정', body: '첫 줄\n\n둘째 줄', notify_discord: false });
    expect(CreateNoticeRequest.safeParse({ title: '제목', body: 'x'.repeat(NOTICE_BODY_MAX_LENGTH + 1) }).success).toBe(false);
    expect(CreateNoticeRequest.safeParse({ title: '제목', body: '   ' }).success).toBe(false);
  });
  it('수정은 한 필드 이상, 모르는 필드 거부', () => {
    expect(UpdateNoticeRequest.safeParse({}).success).toBe(false);
    expect(UpdateNoticeRequest.safeParse({ notify_discord: false }).success).toBe(true);
    expect(UpdateNoticeRequest.safeParse({ title: '제목', pinned: true }).success).toBe(false);
  });
  it('공지 목록 응답', () => {
    const n = {
      id: ID,
      title: '공지',
      body: '본문',
      author: user,
      notify_discord: true,
      discord_notified_at: null,
      created_at: T,
      updated_at: T,
    };
    expect(ListNoticesResponse.parse({ items: [n], next_cursor: null }).items).toHaveLength(1);
  });
  it('패치노트 작성 기본값', () => {
    const r = CreatePatchNoteRequest.parse({ game: 'lol', title: '롤 26.21 패치 요약', summary: '챔피언 조정', published_on: '2026-10-22' });
    expect(r).toMatchObject({ version: null, url: null, notify_discord: false });
    expect(CreatePatchNoteRequest.safeParse({ game: 'valorant', title: '패치', summary: 's', published_on: '2026-10-22' }).success).toBe(false);
  });
  it('이벤트: ends_on 기본 = starts_on, 순서·길이 검사', () => {
    expect(CreateEventRequest.parse({ title: '멤버 대항전', starts_on: '2026-11-07' })).toMatchObject({
      game: null,
      ends_on: '2026-11-07',
    });
    expect(CreateEventRequest.safeParse({ title: '행사', starts_on: '2026-11-07', ends_on: '2026-11-06' }).success).toBe(false);
    expect(CreateEventRequest.safeParse({ title: '행사', starts_on: '2026-01-01', ends_on: '2027-01-03' }).success).toBe(false);
    expect(UpdateEventRequest.safeParse({ starts_on: '2026-11-07', ends_on: '2026-11-01' }).success).toBe(false);
    expect(UpdateEventRequest.safeParse({ ends_on: '2026-11-01' }).success).toBe(true);
  });
  it('이벤트 조회 구간', () => {
    expect(ListEventsQuery.safeParse({ from: '2026-11-01', to: '2026-11-30' }).success).toBe(true);
    expect(ListEventsQuery.safeParse({ from: '2026-11-30', to: '2026-11-01' }).success).toBe(false);
    expect(ListEventsQuery.safeParse({ from: '2026-01-01', to: '2026-12-31' }).success).toBe(false);
    expect(EVENTS_RANGE_MAX_DAYS).toBeGreaterThanOrEqual(42);
    expect(ListEventsResponse.parse({ items: [], next_cursor: null, from: '2026-11-01', to: '2026-11-30' }).from).toBe('2026-11-01');
  });
});

describe('S6 홈 news', () => {
  const base = {
    season: null,
    rating_policy: { min_games: 5, k_base: 32, k_new: 40, new_player_games: 10, loss_ratio: 0.5, full_weight_games: 10, elo_weight_max: 0.2 },
    next_scrim: null,
    recruiting: [],
    stats: { recruiting_scrims: 0, scrims_this_week: 0, week_start: '2026-10-26T00:00:00.000+09:00' },
    community: {
      voice: { state: 'not_connected', member_count: null, captured_at: null },
      active_members: { state: 'not_connected', count: null },
      now_playing: null,
    },
    top_rankers: null,
    top_rankers_state: 'no_season',
    recent_results: [],
    me: null,
  };
  const patch = { kind: 'patch_note', id: ID, game: lol, title: '롤 26.21 패치 요약', subtitle: '챔피언 조정', date: '2026-10-22', url: null };
  const event = { kind: 'event', id: ID2, game: null, title: '멤버 대항전', subtitle: null, date: '2026-11-07', ends_on: '2026-11-07', start_time: null, end_time: null, url: null };
  it('news는 필수(배포 순서, 15절)', () => {
    expect(GetDashboardSummaryResponse.safeParse(base).success).toBe(false);
    expect(GetDashboardSummaryResponse.parse({ ...base, news: { notice: null, items: [] } }).news.items).toEqual([]);
  });
  it('항목은 kind로 나뉘고 최대 4개', () => {
    const n = DashboardNews.parse({ notice: { id: ID, title: '공지', created_at: T }, items: [patch, event] });
    expect(n.items.map((i) => i.kind)).toEqual(['patch_note', 'event']);
    expect(DashboardNews.safeParse({ notice: null, items: [{ ...patch, kind: 'event' }] }).success).toBe(false);
    expect(DashboardNews.safeParse({ notice: null, items: [patch, patch, event, event, event] }).success).toBe(false);
  });
});

describe('S6 알림 설정', () => {
  it('두 항목만, 빈 본문·모르는 필드 거부', () => {
    expect(NotificationSettings.parse({ scrim_start: true, patch: false, discord_linked: true }).patch).toBe(false);
    expect(UpdateMyNotificationSettingsRequest.safeParse({ patch: true }).success).toBe(true);
    expect(UpdateMyNotificationSettingsRequest.safeParse({}).success).toBe(false);
    expect(UpdateMyNotificationSettingsRequest.safeParse({ result: true }).success).toBe(false);
  });
});

describe('S6 멤버·API 키·시즌·감사', () => {
  it('멤버 검색: 빈 q는 조건 없음, 정렬 기본 joined_desc', () => {
    const q = ListAdminMembersQuery.parse({ q: '   ' });
    expect(q.q).toBeUndefined();
    expect(q.sort).toBe('joined_desc');
    expect(ListAdminMembersQuery.parse({ q: ' 감자 ' }).q).toBe('감자');
    expect(ChangeMemberRoleRequest.safeParse({ role: 'owner' }).success).toBe(false);
  });
  it('API 키 발급: scope 1개 이상·중복 금지, 응답 원문 형식', () => {
    expect(CreateApiKeyRequest.safeParse({ name: '디스코드 봇', scopes: ['bot:notices'] }).success).toBe(true);
    expect(CreateApiKeyRequest.safeParse({ name: '봇', scopes: [] }).success).toBe(false);
    expect(CreateApiKeyRequest.safeParse({ name: '봇', scopes: ['bot:notices', 'bot:notices'] }).success).toBe(false);
    expect(CreateApiKeyRequest.safeParse({ name: '봇', scopes: ['bot:link'] }).success).toBe(false);
    const item = { id: ID, name: '봇', key_prefix: 'AbCdEfGh', scopes: ['bot:notices'], last_used_at: null, revoked_at: null, created_by: user, created_at: T };
    expect(CreateApiKeyResponse.safeParse({ api_key: item, key: 'gcd_' + 'A'.repeat(43) }).success).toBe(true);
    expect(CreateApiKeyResponse.safeParse({ api_key: item, key: 'AbCdEfGh' }).success).toBe(false);
  });
  it('시즌 작성·수정 요청', () => {
    expect(CreateSeasonRequest.parse({ name: ' 시즌  3 ', starts_at: T, ends_at: '2027-01-31T15:00:00.000Z' }).name).toBe('시즌 3');
    expect(CreateSeasonRequest.safeParse({ name: '시즌', starts_at: '2026-11-01T00:00:00', ends_at: T }).success).toBe(false);
    expect(UpdateSeasonRequest.safeParse({}).success).toBe(false);
    expect(UpdateSeasonRequest.safeParse({ ends_at: T }).success).toBe(true);
    const s = {
      id: ID,
      name: '시즌 2',
      starts_at: T,
      ends_at: T,
      is_current: true,
      phase: 'current',
      closed_at: null,
      rated_games: 12,
      editable: { name: true, starts_at: false, ends_at: true, delete: false },
    };
    expect(AdminSeasonItem.parse(s).phase).toBe('current');
  });
  it('감사 action → target_type 표가 모든 action을 덮는다', () => {
    for (const a of AdminAuditAction.options) {
      expect(AdminAuditTargetType.options).toContain(ADMIN_AUDIT_TARGET_BY_ACTION[a]);
    }
    expect(Object.keys(ADMIN_AUDIT_TARGET_BY_ACTION).sort()).toEqual([...AdminAuditAction.options].sort());
    // 이의 제기 처리 감사 항목은 없다(D281)
    expect(AdminAuditAction.options as readonly string[]).not.toContain('dispute.resolve');
    expect(AdminAuditTargetType.options as readonly string[]).not.toContain('dispute');
    const row = {
      id: ID,
      actor: user,
      action: 'result.revert',
      target_type: 'scrim_result',
      target_id: ID2,
      summary: '일요일 협곡 내전 결과 승인을 되돌림',
      details: { reason: '승패 반대', history: [{ user_id: ID, elo_before: 1000, elo_after: 1016 }] },
      created_at: T,
    };
    expect(AdminAuditLogItem.parse(row).details.reason).toBe('승패 반대');
  });
});

describe('S6 봇 공지·패치노트 전송', () => {
  it('대기 목록·전송 완료', () => {
    const author = { ...user, discord_id: SNOW, profile_url: 'https://gcd.example/members/' + ID };
    expect(
      GetBotPendingNoticesResponse.parse({
        items: [{ id: ID, title: '공지', body: '본문', author, created_at: T, web_url: 'https://gcd.example/news' }],
        next_cursor: null,
        generated_at: T,
      }).items,
    ).toHaveLength(1);
    expect(
      GetBotPendingPatchNotesResponse.parse({
        items: [
          {
            id: ID,
            game: lol,
            version: '26.21',
            title: '롤 26.21 패치 요약',
            summary: '요약',
            url: null,
            published_on: '2026-10-22',
            created_at: T,
            web_url: 'https://gcd.example/news',
            notify_discord_ids: [SNOW],
          },
        ],
        next_cursor: null,
        generated_at: T,
      }).items[0]!.notify_discord_ids,
    ).toEqual([SNOW]);
    expect(PostBotDeliveredRequest.safeParse({}).success).toBe(true);
    expect(PostBotDeliveredRequest.safeParse({ ok: true }).success).toBe(false);
    expect(PostBotDeliveredResponse.parse({ id: ID, status: 'already_delivered', discord_notified_at: T }).status).toBe('already_delivered');
  });
});
