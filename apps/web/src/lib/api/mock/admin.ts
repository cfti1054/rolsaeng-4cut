import {
  adminMemberStatus,
  calendarMonthRange,
  compareEventSchedule,
  computeScrimRestriction,
  dashboardNewsWindow,
  isNoShowMarkWindowOpen,
  kstDateKey,
  kstMonthWindow,
  kstWeekWindow,
  mergeUpcomingItems,
  newsSubtitle,
  noShowLookbackStart,
  planRatingRevert,
  planRoleChange,
  previewNoShowRestriction,
  resolveCalendarMonth,
  resolveEventsRange,
  revertBlockReason,
  seasonEditable,
  seasonPhase,
  upcomingWindow,
  validateSeasonDelete,
  validateSeasonWrite,
  type NoShowPolicy,
} from '@gcd/core';
import {
  ADMIN_AUDIT_TARGET_BY_ACTION,
  ADMIN_UPCOMING_DAYS,
  ADMIN_UPCOMING_MAX,
  API_KEY_DISPLAY_PREFIX_LENGTH,
  API_KEY_PREFIX,
  AdminAuditAction,
  AdminIdParams,
  ApiKeyScope,
  ApiPath,
  CALENDAR_EVENTS_MAX,
  CALENDAR_SCRIMS_MAX,
  ChangeMemberRoleRequest,
  CreateApiKeyRequest,
  CreateEventRequest,
  CreateNoticeRequest,
  CreatePatchNoteRequest,
  CreateSeasonRequest,
  DASHBOARD_NEWS_EVENTS_MAX,
  DASHBOARD_NEWS_EVENT_AHEAD_DAYS,
  DASHBOARD_NEWS_PATCH_NOTES_MAX,
  DASHBOARD_NEWS_PATCH_RECENT_DAYS,
  DASHBOARD_NEWS_SUBTITLE_MAX,
  EventTime,
  GameCode,
  GetCalendarQuery,
  IsoDate,
  IsoDateTime,
  ListAdminAuditLogsQuery,
  ListAdminMembersQuery,
  ListAdminNoShowScrimsQuery,
  ListAdminResultsQuery,
  ListEventsQuery,
  ListNoticesQuery,
  ListPatchNotesQuery,
  RevertScrimResultRequest,
  SCRIM_RESULT_REVERT_WINDOW_DAYS,
  SEASON_CLOSE_GRACE_SEC,
  SEASON_EDIT_MIN_LEAD_SEC,
  SEASON_LENGTH_MAX_DAYS,
  SEASON_LENGTH_MIN_DAYS,
  UpdateEventRequest,
  eventScheduleIssues,
  UpdateMyNotificationSettingsRequest,
  UpdateNoticeRequest,
  UpdatePatchNoteRequest,
  UpdateSeasonRequest,
  UserRole,
  Uuid,
  isLinkedDiscordId,
  type AdminApiKeyItem,
  type AdminAuditLogItem,
  type AdminMemberItem,
  type AdminNoShowScrim,
  type AdminOverview,
  type AdminResultItem,
  type AdminSeasonItem,
  type AdminUpcoming,
  type CalendarEventItem,
  type CalendarItem,
  type CalendarScrimItem,
  type CalendarScrimStatus,
  type GetCalendarResponse,
  type DashboardNews,
  type ErrorCode,
  type EventView,
  type Me,
  type NoticeView,
  type PatchNoteView,
  type ScrimDetail,
  type ScrimGameRef,
  type ScrimPlayerStatus,
  type ScrimRatingStatus,
  type ScrimResultRevertBlock,
  type ScrimSummary,
  type ScrimUserRef,
} from '@gcd/shared';
import { z } from 'zod';
import { currentSeason, latestResult, type MockHistory, type MockResult, type MockSeason, type S3Data } from './ratings';

/**
 * [목] S6 엔드포인트(계약 S6 4절) 중 웹이 부르는 28개: 공지·패치노트·이벤트 읽기 3, 알림 설정 2, 되돌리기 1, 운영진 22.
 * 규칙 판정은 @gcd/core S6 함수를 그대로 쓴다(되돌리기 막는 이유·역반영 계획, 시즌 단계·검사, 역할 변경, 멤버 상태, 노쇼 미리보기, 홈 news).
 * 저장소는 S2 목 상태(MockS2State)에 붙는 필드(MockS6Fields)다. 시드는 scrims.ts seed()가 seedS6를 부른다.
 *
 * 상태 확인: localStorage `gcd-mock-admin`에 아래 값을 넣고 새로고침한다.
 *   empty    공지·패치노트·이벤트·감사 로그·API 키·결과 큐·노쇼 후보가 빈 상태
 *   error    /admin/*·/notices·/patch-notes·/events·/me/notification-settings가 INTERNAL_ERROR
 *   demoted  운영진 API가 FORBIDDEN(웹에서 강등된 직후, D263). 첫 403 뒤 GET /me가 role member를 돌려준다(backend.ts)
 */

export const MOCK_ADMIN_SCENARIO_KEY = 'gcd-mock-admin';
export const MockAdminScenario = z.enum(['empty', 'error', 'demoted']);
export type MockAdminScenario = z.infer<typeof MockAdminScenario>;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const iso = (t: number) => new Date(t).toISOString();

// -----------------------------------------------------------------------------
// 저장 형식
// -----------------------------------------------------------------------------

const MockNotice = z.object({
  id: Uuid,
  title: z.string(),
  body: z.string(),
  author_id: Uuid,
  notify_discord: z.boolean(),
  discord_notified_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
type MockNotice = z.infer<typeof MockNotice>;

const MockPatchNote = z.object({
  id: Uuid,
  game: GameCode,
  version: z.string().nullable(),
  title: z.string(),
  summary: z.string(),
  url: z.string().nullable(),
  published_on: IsoDate,
  notify_discord: z.boolean(),
  discord_notified_at: IsoDateTime.nullable(),
  auto_registered: z.boolean().default(false),
  created_by: Uuid.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
type MockPatchNote = z.infer<typeof MockPatchNote>;

const MockEvent = z.object({
  id: Uuid,
  game: GameCode.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  url: z.string().nullable(),
  starts_on: IsoDate,
  ends_on: IsoDate,
  /** S6 후속(D298): KST 벽시계 시각. 시각 도입 전 저장된 목 상태는 null(종일)로 읽는다 */
  start_time: EventTime.nullable().default(null),
  end_time: EventTime.nullable().default(null),
  created_by: Uuid.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
type MockEvent = z.infer<typeof MockEvent>;

const MockAudit = z.object({
  id: Uuid,
  actor_id: Uuid.nullable(),
  action: AdminAuditAction,
  target_id: Uuid.nullable(),
  summary: z.string(),
  details: z.record(z.string(), z.unknown()),
  created_at: IsoDateTime,
});
type MockAudit = z.infer<typeof MockAudit>;

const MockApiKey = z.object({
  id: Uuid,
  name: z.string(),
  key_prefix: z.string(),
  scopes: z.array(ApiKeyScope),
  last_used_at: IsoDateTime.nullable(),
  revoked_at: IsoDateTime.nullable(),
  created_by: Uuid.nullable(),
  created_at: IsoDateTime,
});
type MockApiKey = z.infer<typeof MockApiKey>;

/** 다른 멤버의 운영 정보(나는 Me 값을 쓴다) */
const MockMemberMeta = z.object({
  user_id: Uuid,
  role: UserRole,
  role_locked: z.boolean(),
  discord_username: z.string().nullable(),
  joined_at: IsoDateTime,
  last_login_at: IsoDateTime.nullable(),
  left_at: IsoDateTime.nullable(),
});
type MockMemberMeta = z.infer<typeof MockMemberMeta>;

/** MockS2State에 붙는 S6 저장소 */
export const MockS6Fields = {
  notices: z.array(MockNotice).default([]),
  patch_notes: z.array(MockPatchNote).default([]),
  events: z.array(MockEvent).default([]),
  audit: z.array(MockAudit).default([]),
  api_keys: z.array(MockApiKey).default([]),
  members: z.array(MockMemberMeta).default([]),
  /** 운영진이 삭제한 회원 id. 시드 회원도 목록에서 빠지도록 기록한다 */
  deleted_user_ids: z.array(Uuid).default([]),
  notify: z.object({ scrim_start: z.boolean(), patch: z.boolean() }).default({ scrim_start: true, patch: false }),
};
export interface S6Data {
  notices: MockNotice[];
  patch_notes: MockPatchNote[];
  events: MockEvent[];
  audit: MockAudit[];
  api_keys: MockApiKey[];
  members: MockMemberMeta[];
  deleted_user_ids: string[];
  notify: { scrim_start: boolean; patch: boolean };
}
export const emptyS6 = (): S6Data => ({
  notices: [],
  patch_notes: [],
  events: [],
  audit: [],
  api_keys: [],
  members: [],
  deleted_user_ids: [],
  notify: { scrim_start: true, patch: false },
});

/** S6 핸들러가 읽는 내전 목 행(scrims.ts MockScrim·MockPlayer의 일부) */
interface S6Scrim {
  id: string;
  game: GameCode;
  title: string;
  scheduled_at: string;
  status: string;
  host_id: string;
  rated: boolean;
  started_at: string | null;
  updated_at: string;
}
interface S6Player {
  scrim_id: string;
  user_id: string;
  status: ScrimPlayerStatus;
  no_show_marked_at: string | null;
}
export type S6State = S3Data & S6Data & { scrims: S6Scrim[]; players: S6Player[] };

// -----------------------------------------------------------------------------
// 공통 규칙(상세 viewer·결과 필드도 여기서 계산한다)
// -----------------------------------------------------------------------------

/** 종료 작업 시각 흉내(rankings.ts와 같은 규칙: ends_at + 유예). 목에는 closed_at 컬럼이 없다 */
export function mockSeasonClosedAt(s: MockSeason, now: number): string | null {
  const t = Date.parse(s.ends_at) + SEASON_CLOSE_GRACE_SEC * 1000;
  return t <= now ? iso(t) : null;
}

const historyOf = (st: S3Data, resultId: string): MockHistory[] => st.history.filter((h) => h.result_id === resultId);

/** 6-2 later_games: 이 결과 이력의 각 (user, game)에 다른 결과의 이력이 같은 시각 이후에 있음(모든 시즌) */
function laterGameUserIds(st: S3Data, resultId: string): string[] {
  return historyOf(st, resultId)
    .filter((h) =>
      st.history.some((o) => o.result_id !== resultId && o.user_id === h.user_id && o.game === h.game && Date.parse(o.created_at) >= Date.parse(h.created_at)),
    )
    .map((h) => h.user_id);
}

/** approved 결과의 되돌리기 막는 이유(core revertBlockReason, rating_mismatch 제외) */
export function mockRevertBlock(st: S3Data, r: MockResult, actorId: string, now: number): Exclude<ScrimResultRevertBlock, 'rating_mismatch'> | null {
  const hist = historyOf(st, r.id);
  const season = hist[0] ? st.seasons.find((s) => s.id === hist[0]!.season_id) : undefined;
  return revertBlockReason({
    approvedAt: new Date(r.approved_at ?? r.created_at),
    now: new Date(now),
    windowDays: SCRIM_RESULT_REVERT_WINDOW_DAYS,
    submittedById: r.submitted_by,
    actorId,
    seasonClosed: season ? mockSeasonClosedAt(season, now) !== null : false,
    laterGameUserIds: laterGameUserIds(st, r.id),
  });
}

/** 상세 viewer S6 되돌리기 2필드(계약 S6 6-4) */
export function mockS6Viewer(
  st: S6State,
  input: { scrim: S6Scrim; latest: MockResult | null; me: Me; now: number },
): Pick<ScrimDetail['viewer'], 'can_revert_result' | 'revert_blocked_reason'> {
  const { latest, me, now } = input;
  const isAdmin = me.role === 'admin';
  const revertBlocked = isAdmin && latest?.status === 'approved' ? mockRevertBlock(st, latest, me.id, now) : null;
  return {
    can_revert_result: isAdmin && latest?.status === 'approved' && revertBlocked === null,
    revert_blocked_reason: revertBlocked,
  };
}

function ratingStatusOf(st: S3Data, r: MockResult, rated: boolean): ScrimRatingStatus {
  if (!rated) return 'not_rated';
  if (r.status === 'approved') return historyOf(st, r.id).length > 0 ? 'applied' : 'skipped';
  return 'waiting';
}

/** 홈 news 블록(계약 S6 8-3) */
export function mockDashboardNews(st: S6Data, now: number, opts: { scenario: MockAdminScenario | null; userRef: (id: string) => ScrimUserRef; gameRef: (c: GameCode) => ScrimGameRef }): DashboardNews {
  if (opts.scenario === 'empty') return { notice: null, items: [] };
  const w = dashboardNewsWindow(new Date(now), DASHBOARD_NEWS_PATCH_RECENT_DAYS, DASHBOARD_NEWS_EVENT_AHEAD_DAYS);
  const notice = [...st.notices].sort(byCreatedDesc)[0];
  const patches = st.patch_notes
    .filter((p) => p.published_on >= w.patchSince)
    .sort(patchOrder)
    .slice(0, DASHBOARD_NEWS_PATCH_NOTES_MAX);
  const events = st.events
    .filter((e) => e.ends_on >= w.today && e.starts_on <= w.eventUntil)
    .sort(eventOrder)
    .slice(0, DASHBOARD_NEWS_EVENTS_MAX);
  return {
    notice: notice ? { id: notice.id, title: notice.title, created_at: notice.created_at } : null,
    items: [
      ...patches.map((p) => ({
        kind: 'patch_note' as const,
        id: p.id,
        game: opts.gameRef(p.game),
        title: p.title,
        subtitle: newsSubtitle(p.summary, DASHBOARD_NEWS_SUBTITLE_MAX),
        date: p.published_on,
        url: p.url,
      })),
      ...events.map((e) => ({
        kind: 'event' as const,
        id: e.id,
        game: e.game ? opts.gameRef(e.game) : null,
        title: e.title,
        subtitle: newsSubtitle(e.description, DASHBOARD_NEWS_SUBTITLE_MAX),
        date: e.starts_on,
        ends_on: e.ends_on,
        start_time: e.start_time,
        end_time: e.end_time,
        url: e.url,
      })),
    ],
  };
}

const byCreatedDesc = (a: { created_at: string; id: string }, b: { created_at: string; id: string }) =>
  Date.parse(b.created_at) - Date.parse(a.created_at) || (a.id < b.id ? 1 : -1);
const patchOrder = (a: MockPatchNote, b: MockPatchNote) => (a.published_on < b.published_on ? 1 : a.published_on > b.published_on ? -1 : byCreatedDesc(a, b));
/** 일정 정렬(D302) = core compareEventSchedule(서버 EVENT_ORDER_BY와 같은 순서) */
const eventOrder = (a: MockEvent, b: MockEvent) => compareEventSchedule(a, b);

// -----------------------------------------------------------------------------
// 시드
// -----------------------------------------------------------------------------

export interface S6SeedInput {
  me: Me;
  now: number;
  newId: () => string;
  users: readonly ScrimUserRef[];
  /** 닉네임 → id */
  U: Record<string, string>;
}

/** 오늘(KST) ± n일 'YYYY-MM-DD' */
function kstDay(now: number, n: number): string {
  return new Date(now + 9 * HOUR_MS + n * DAY_MS).toISOString().slice(0, 10);
}

export function seedS6(st: S6State, input: S6SeedInput): void {
  const { me, now, newId, U } = input;
  const admin1 = U['미드고정']!;
  const admin2 = U['서폿요정']!;
  const discordNames: Record<string, string | null> = {
    미드고정: 'midgojung',
    정글차이: 'jungle_diff',
    원딜장인: 'adc_master',
    서폿요정: 'sup_fairy',
    한타각: 'teamfight_kr',
    바론스틸: 'baron_steal',
    별빛미드: null,
    무한점멸: 'flash_inf',
    와드지기: 'ward_keeper',
    칼바람러: 'aram_lover',
    용용이: null,
    체스왕: 'chess_king',
  };
  st.members = input.users.map((u, i) => ({
    user_id: u.id,
    role: u.id === admin1 || u.id === admin2 ? 'admin' : 'member',
    role_locked: u.id === admin1,
    discord_username: discordNames[u.nickname] ?? null,
    joined_at: iso(now - (220 - i * 14) * DAY_MS),
    last_login_at: u.nickname === '용용이' ? null : iso(now - (i % 5) * 9 * HOUR_MS - 20 * MIN_MS),
    left_at: u.nickname === '와드지기' ? iso(now - 10 * DAY_MS) : null,
  }));

  const t = (ms: number) => iso(now - ms);
  st.notices = [
    {
      id: newId(),
      title: '11월 내전 일정 안내',
      body: '11월에는 매주 화·토요일 저녁 9시에 정기 내전을 열어요.\n참가 신청은 내전 화면에서 해 주세요.',
      author_id: admin1,
      notify_discord: true,
      discord_notified_at: t(115 * MIN_MS),
      created_at: t(2 * HOUR_MS),
      updated_at: t(2 * HOUR_MS),
    },
    {
      id: newId(),
      title: '3분기 마무리 안내',
      body: '분기가 끝나면 최종 순위를 저장하고 상위 3명에게 뱃지를 드려요.',
      author_id: admin2,
      notify_discord: true,
      discord_notified_at: null,
      created_at: t(20 * HOUR_MS),
      updated_at: t(20 * HOUR_MS),
    },
    {
      id: newId(),
      title: '노쇼 정책 안내',
      body: '시작 시각에 오지 않으면 운영진이 노쇼로 표시해요. 누적되면 잠시 참가가 제한돼요.',
      author_id: admin1,
      notify_discord: true,
      discord_notified_at: null,
      created_at: t(5 * DAY_MS),
      updated_at: t(5 * DAY_MS),
    },
    {
      id: newId(),
      title: '디스코드 서버 규칙 업데이트',
      body: '음성 채널 이용 규칙이 바뀌었어요. #공지 채널을 확인해 주세요.',
      author_id: admin2,
      notify_discord: false,
      discord_notified_at: null,
      created_at: t(12 * DAY_MS),
      updated_at: t(12 * DAY_MS),
    },
  ];
  const patch = (game: GameCode, version: string | null, title: string, summary: string, daysAgo: number, url: string | null): MockPatchNote => ({
    id: newId(),
    game,
    version,
    title,
    summary,
    url,
    published_on: kstDay(now, -daysAgo),
    notify_discord: daysAgo < 10,
    discord_notified_at: daysAgo < 10 ? t((daysAgo * 24 - 1) * HOUR_MS) : null,
    auto_registered: false,
    created_by: admin1,
    created_at: t(daysAgo * DAY_MS),
    updated_at: t(daysAgo * DAY_MS),
  });
  st.patch_notes = [
    patch('lol', '26.21', '26.21 패치: 정글 경험치 조정', '정글 몬스터 경험치가 소폭 줄고 바위게 등장 시간이 30초 늦어져요.\n원딜 아이템 2종 가격이 내려가요.', 3, 'https://www.leagueoflegends.com/ko-kr/news/game-updates/'),
    patch('tft', '15.7', '15.7 패치: 증강 체력 하향', '전투 증강 3종의 체력 보너스가 줄어들어요. 4코스트 챔피언 일부가 강해져요.', 8, 'https://teamfighttactics.leagueoflegends.com/ko-kr/news/'),
    patch('lol', '26.20', '26.20 패치: 신규 챔피언 출시', '신규 챔피언이 추가되고 서포터 아이템 퀘스트 조건이 바뀌어요.', 17, null),
    patch('tft', '15.6', '15.6 패치: 시즌 중반 밸런스', '경제 관련 증강 조정과 함께 3코스트 챔피언 밸런스가 바뀌어요.', 40, null),
  ];
  const ev = (
    game: GameCode | null,
    title: string,
    description: string | null,
    from: number,
    to: number,
    url: string | null = null,
    time: { start: string; end?: string } | null = null,
  ): MockEvent => ({
    id: newId(),
    game,
    title,
    description,
    url,
    starts_on: kstDay(now, from),
    ends_on: kstDay(now, to),
    start_time: time?.start ?? null,
    end_time: time?.end ?? null,
    created_by: admin2,
    created_at: t(20 * DAY_MS),
    updated_at: t(20 * DAY_MS),
  });
  st.events = [
    ev(null, '서버 2주년 이벤트', '기간 중 내전에 참가하면 디스코드 역할을 드려요.', -1, 4),
    // S6 후속(D298) 시각 일정: 하루 시작·끝, 여러 날 시작만
    ev('lol', '월즈 결승 응원 내전', '결승 전 저녁 7시 협곡 내전. 끝나고 같이 결승을 봐요.', 2, 2, null, { start: '19:00', end: '23:00' }),
    ev('tft', '롤체 신규 세트 출시', '새 세트 출시 주간. 연습 로비를 매일 열어요.', 6, 10, 'https://teamfighttactics.leagueoflegends.com/ko-kr/', { start: '21:00' }),
    ev('lol', '할로윈 칼바람 이벤트', null, -12, -9),
    ev('lol', '연말 토너먼트 예선', '5인 팀 단위 예선. 신청은 공지를 확인해 주세요.', 35, 37),
  ];

  st.api_keys = [
    { id: newId(), name: '디스코드 봇 (운영)', key_prefix: 'Ab3dK9xQ', scopes: ['bot:activity', 'bot:users:read', 'bot:scrims:read', 'bot:rankings:read', 'bot:members', 'bot:presence'], last_used_at: t(3 * MIN_MS), revoked_at: null, created_by: admin1, created_at: t(40 * DAY_MS) },
    { id: newId(), name: 'CLI 테스트 키', key_prefix: 'Zt7pQ2mN', scopes: ['bot:activity'], last_used_at: t(25 * DAY_MS), revoked_at: t(20 * DAY_MS), created_by: null, created_at: t(30 * DAY_MS) },
  ];
  const n0 = st.notices[0]!;
  st.audit = [
    { id: newId(), actor_id: admin1, action: 'notice.create', target_id: n0.id, summary: `공지 '${n0.title}' 작성`, details: { title: n0.title, notify_discord: true }, created_at: n0.created_at },
    { id: newId(), actor_id: admin1, action: 'api_key.create', target_id: st.api_keys[0]!.id, summary: "API 키 '디스코드 봇 (운영)' 발급", details: { name: '디스코드 봇 (운영)', key_prefix: 'Ab3dK9xQ', scopes: st.api_keys[0]!.scopes }, created_at: st.api_keys[0]!.created_at },
    { id: newId(), actor_id: admin1, action: 'member.role_change', target_id: admin2, summary: '서폿요정 역할을 운영진으로 변경', details: { from: 'member', to: 'admin' }, created_at: t(45 * DAY_MS) },
  ];
}

// -----------------------------------------------------------------------------
// 핸들러
// -----------------------------------------------------------------------------

export interface MockS6Context {
  method: string;
  path: string;
  search: URLSearchParams;
  body: unknown;
  me: Me;
  now: number;
  state: S6State;
  persist: () => void;
  json: (status: number, body: unknown) => Response;
  error: (code: ErrorCode, message: string, opts?: { details?: { path: string; message: string }[] }) => Response;
  scenario: MockAdminScenario | null;
  /** rankings 시나리오 stale이면 랭킹 캐시 실패 키를 흉내 낸다 */
  rankingStale: boolean;
  noShowPolicy: NoShowPolicy;
  markWindowDays: number;
  users: readonly ScrimUserRef[];
  userRef: (id: string) => ScrimUserRef;
  gameRef: (code: GameCode) => ScrimGameRef;
  /** 상세 슬롯 순서 참가자(joined·no_show) */
  slotRows: (scrimId: string) => S6Player[];
  detail: (scrimId: string) => ScrimDetail;
  /** 같은 요청자의 GET /scrims 목록 카드(캘린더 내전 항목 투영용, 계약 S6 23-2 D287) */
  summary: (scrimId: string) => ScrimSummary;
  rankingSyncedAt: () => string;
}

const S6_EXACT: readonly string[] = [ApiPath.notices, ApiPath.patchNotes, ApiPath.events, ApiPath.myNotificationSettings, ApiPath.calendar];
export function isS6Path(path: string): boolean {
  return S6_EXACT.includes(path) || path.startsWith('/admin/') || /^\/scrims\/[^/]+\/result\/revert$/.test(path);
}

function match(template: string, path: string): Record<string, string> | null {
  const names: string[] = [];
  const re = new RegExp(`^${template.replace(/:([A-Za-z_]+)/g, (_, n: string) => (names.push(n), '([^/]+)'))}$`);
  const m = re.exec(path);
  return m ? Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1] ?? '')])) : null;
}

const issues = (e: z.ZodError) => e.issues.map((i) => ({ path: i.path.join('.') || 'body', message: i.message }));

/** 불투명 오프셋 커서(서버 멤버 목록과 같은 방식, D266) */
function encodeOffset(o: number, s: string): string {
  return btoa(JSON.stringify({ o, s })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeOffset(raw: string, s: string): number | null {
  try {
    const b = raw.replace(/-/g, '+').replace(/_/g, '/');
    const v = JSON.parse(atob(b + '='.repeat((4 - (b.length % 4)) % 4))) as { o?: unknown; s?: unknown };
    return typeof v.o === 'number' && v.s === s ? v.o : null;
  } catch {
    return null;
  }
}

function quote(text: string): string {
  const chars = Array.from(text);
  return chars.length > 40 ? `${chars.slice(0, 40).join('')}…` : text;
}

/** S6 경로가 아니면 null */
export function handleS6(ctx: MockS6Context): Response | null {
  const { method, path, me, now, json, error, state: st } = ctx;
  if (!isS6Path(path)) return null;
  const isAdmin = me.role === 'admin';
  const empty = ctx.scenario === 'empty';
  const q = Object.fromEntries(ctx.search.entries());
  const bad = (e: z.ZodError) => error('VALIDATION_FAILED', '요청 형식이 올바르지 않습니다.', { details: issues(e) });
  const audit = (action: AdminAuditAction, targetId: string | null, summary: string, details: Record<string, unknown>) =>
    st.audit.push({ id: crypto.randomUUID(), actor_id: me.id, action, target_id: targetId, summary, details, created_at: iso(now) });

  function page<T>(items: readonly T[], key: string): { items: T[]; next_cursor: string | null } | Response {
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 20) || 20));
    let off = 0;
    if (q.cursor) {
      const o = decodeOffset(q.cursor, key);
      if (o === null) return error('VALIDATION_FAILED', '커서가 올바르지 않습니다.', { details: [{ path: 'cursor', message: 'invalid cursor' }] });
      off = o;
    }
    const slice = items.slice(off, off + limit);
    return { items: slice, next_cursor: off + limit < items.length ? encodeOffset(off + limit, key) : null };
  }
  const reply = (p: ReturnType<typeof page>, extra: Record<string, unknown> = {}) => (p instanceof Response ? p : json(200, { ...p, ...extra }));

  if (ctx.scenario === 'error' && !path.startsWith('/scrims/')) return error('INTERNAL_ERROR', '목 오류 상태');

  // ---- 멤버 전원 ----
  const noticeView = (n: MockNotice): NoticeView => ({
    id: n.id,
    title: n.title,
    body: n.body,
    author: ctx.userRef(n.author_id),
    notify_discord: n.notify_discord,
    discord_notified_at: n.discord_notified_at,
    created_at: n.created_at,
    updated_at: n.updated_at,
  });
  const patchView = (p: MockPatchNote): PatchNoteView => ({
    id: p.id,
    game: ctx.gameRef(p.game),
    version: p.version,
    title: p.title,
    summary: p.summary,
    url: p.url,
    published_on: p.published_on,
    notify_discord: p.notify_discord,
    discord_notified_at: p.discord_notified_at,
    auto_registered: p.auto_registered,
    created_at: p.created_at,
    updated_at: p.updated_at,
  });
  const eventView = (e: MockEvent): EventView => ({
    id: e.id,
    game: e.game ? ctx.gameRef(e.game) : null,
    title: e.title,
    description: e.description,
    url: e.url,
    starts_on: e.starts_on,
    ends_on: e.ends_on,
    start_time: e.start_time,
    end_time: e.end_time,
    created_at: e.created_at,
    updated_at: e.updated_at,
  });
  /** 캘린더·「다가오는 일정」 내전 항목 = 같은 요청자의 목록 카드 투영(D287, 서버 toCalendarScrimItem) */
  const scrimItem = (id: string): CalendarScrimItem => {
    const c = ctx.summary(id);
    return {
      kind: 'scrim',
      id: c.id,
      title: c.title,
      game: c.game,
      steam_app: c.steam_app,
      custom_game_name: c.custom_game_name,
      date: kstDateKey(new Date(c.scheduled_at)),
      scheduled_at: c.scheduled_at,
      status: c.status as CalendarScrimStatus,
      capacity: c.capacity,
      joined_count: c.joined_count,
      join_closed: c.join_closed,
      my_status: c.my_status,
      result_status: c.result_status,
    };
  };
  const eventItem = (e: MockEvent): CalendarEventItem => ({ ...eventView(e), kind: 'event' });
  const byScheduled = (a: S6Scrim, b: S6Scrim) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  if (method === 'GET' && path === ApiPath.notices) {
    const p = ListNoticesQuery.safeParse(q);
    if (!p.success) return bad(p.error);
    return reply(page(empty ? [] : [...st.notices].sort(byCreatedDesc).map(noticeView), 'notices'));
  }
  if (method === 'GET' && path === ApiPath.patchNotes) {
    const p = ListPatchNotesQuery.safeParse(q);
    if (!p.success) return bad(p.error);
    const rows = empty ? [] : st.patch_notes.filter((x) => !p.data.game || x.game === p.data.game).sort(patchOrder);
    return reply(page(rows.map(patchView), `patch:${p.data.game ?? ''}`));
  }
  if (method === 'GET' && path === ApiPath.events) {
    const p = ListEventsQuery.safeParse(q);
    if (!p.success) return bad(p.error);
    const range = resolveEventsRange({ from: p.data.from, to: p.data.to }, new Date(now));
    const rows = (empty ? [] : st.events)
      .filter((e) => e.starts_on <= range.to && e.ends_on >= range.from && (!p.data.game || e.game === p.data.game))
      .sort(eventOrder);
    return reply(page(rows.map(eventView), `events:${range.from}:${range.to}:${p.data.game ?? ''}`), range);
  }
  // S6 후속 커뮤니티 캘린더(계약 S6 23-2·23-3): 일정 전부 → 내전 전부, 종류별 한도 + truncated
  if (method === 'GET' && path === ApiPath.calendar) {
    const p = GetCalendarQuery.safeParse(q);
    if (!p.success) return bad(p.error);
    const month = resolveCalendarMonth(p.data.month, new Date(now));
    const r = calendarMonthRange(month);
    const game = p.data.game;
    // GameCode는 시드 게임 목록과 같은 enum이라 「games 행 없는 코드」는 목에서 생기지 않는다(형식 오류 400)
    const evRows = empty ? [] : st.events.filter((e) => e.starts_on <= r.to && e.ends_on >= r.from && (!game || e.game === game)).sort(eventOrder);
    const fromMs = r.fromAt.getTime();
    const toMs = r.toBefore.getTime();
    const scRows = (empty ? [] : st.scrims)
      .filter((s) => s.status !== 'cancelled' && (!game || s.game === game))
      .filter((s) => {
        const t = Date.parse(s.scheduled_at);
        return t >= fromMs && t < toMs;
      })
      .sort(byScheduled);
    const items: CalendarItem[] = [
      ...evRows.slice(0, CALENDAR_EVENTS_MAX).map(eventItem),
      ...scRows.slice(0, CALENDAR_SCRIMS_MAX).map((s) => scrimItem(s.id)),
    ];
    const res: GetCalendarResponse = {
      month,
      from: r.from,
      to: r.to,
      items,
      truncated: { scrims: scRows.length > CALENDAR_SCRIMS_MAX, events: evRows.length > CALENDAR_EVENTS_MAX },
    };
    return json(200, res);
  }
  if (path === ApiPath.myNotificationSettings) {
    const view = () => ({ ...st.notify, discord_linked: isLinkedDiscordId(me.discord_id) });
    if (method === 'GET') return json(200, view());
    if (method === 'PATCH') {
      const p = UpdateMyNotificationSettingsRequest.safeParse(ctx.body);
      if (!p.success) return bad(p.error);
      st.notify = { scrim_start: p.data.scrim_start ?? st.notify.scrim_start, patch: p.data.patch ?? st.notify.patch };
      ctx.persist();
      return json(200, view());
    }
  }

  // ---- 여기부터 운영진(역할 검사가 먼저, 없는 리소스여도 403) ----
  if (!isAdmin) return error('FORBIDDEN', '운영진만 사용할 수 있습니다.');

  let m = match(ApiPath.scrimResultRevert, path);
  if (m && method === 'POST') {
    if (!Uuid.safeParse(m.id).success) return error('VALIDATION_FAILED', 'id 형식', { details: [{ path: 'id', message: 'uuid' }] });
    const p = RevertScrimResultRequest.safeParse(ctx.body);
    if (!p.success) return bad(p.error);
    const s = st.scrims.find((x) => x.id === m!.id);
    if (!s) return error('NOT_FOUND', '내전 없음');
    const approved = st.results.find((r) => r.scrim_id === s.id && r.status === 'approved');
    if (!approved || approved.id !== p.data.result_id) return error('SCRIM_RESULT_NOT_APPROVED', '승인된 결과가 아님');
    const block = mockRevertBlock(st, approved, me.id, now);
    if (block === 'self_submitted') return error('SCRIM_RESULT_SELF_REVIEW', '자기 제출');
    if (block) return error('SCRIM_RESULT_REVERT_NOT_ALLOWED', block);
    const hist = historyOf(st, approved.id);
    const seasonId = hist[0]?.season_id;
    const ratings = st.ratings.filter((r) => r.game === s.game && r.season_id === seasonId && hist.some((h) => h.user_id === r.user_id));
    const plan = planRatingRevert({
      history: hist.map((h) => ({ id: h.id, userId: h.user_id, eloBefore: h.elo_before, eloAfter: h.elo_after, createdAt: new Date(h.created_at) })),
      ratings: ratings.map((r) => ({ userId: r.user_id, elo: r.elo, wins: r.wins, losses: r.losses })),
      outcomes: new Map(hist.map((h) => [h.user_id, h.outcome])),
    });
    if (!plan.ok) return error('SCRIM_RESULT_REVERT_NOT_ALLOWED', 'rating_mismatch');
    for (const u of plan.updates) Object.assign(ratings.find((r) => r.user_id === u.userId)!, { elo: u.elo, wins: u.wins, losses: u.losses });
    st.history = st.history.filter((h) => h.result_id !== approved.id);
    Object.assign(approved, { status: 'reverted', reverted_by: me.id, reverted_at: iso(now), revert_reason: p.data.reason });
    Object.assign(s, { status: 'playing', updated_at: iso(now) });
    audit('result.revert', approved.id, `'${quote(s.title)}' 결과 승인 되돌리기`, {
      scrim_id: s.id,
      reason: p.data.reason,
      season_id: seasonId ?? null,
      history: hist.map((h) => ({ user_id: h.user_id, elo_before: h.elo_before, elo_after: h.elo_after, k_factor: h.k_factor, outcome: h.outcome })),
    });
    ctx.persist();
    return json(200, ctx.detail(s.id));
  }

  if (!path.startsWith('/admin/')) return null;

  const scrimRef = (s: S6Scrim) => ({ id: s.id, title: s.title, game: ctx.gameRef(s.game), scheduled_at: s.scheduled_at });
  const policy = ctx.noShowPolicy;
  const marksOf = (userId: string) => {
    const since = noShowLookbackStart(new Date(now), policy).getTime();
    return st.players
      .filter((p) => p.user_id === userId && p.status === 'no_show' && p.no_show_marked_at && Date.parse(p.no_show_marked_at) > since)
      .map((p) => new Date(p.no_show_marked_at!));
  };
  const restrictionOf = (userId: string) => computeScrimRestriction(marksOf(userId), new Date(now), policy);

  // ---- 통계 ----
  if (method === 'GET' && path === ApiPath.adminOverview) {
    const nowD = new Date(now);
    const week = kstWeekWindow(nowD);
    const month = kstMonthWindow(nowD);
    const last = kstMonthWindow(new Date(month.start.getTime() - 1));
    const users = memberRows();
    const pending = empty ? [] : st.results.filter((r) => r.status === 'pending');
    const inRange = (iso2: string | null, w: { start: Date; end: Date }) => !!iso2 && Date.parse(iso2) >= w.start.getTime() && Date.parse(iso2) < w.end.getTime();
    const restricted = users.map((u) => restrictionOf(u.id)).filter((r) => r.restricted);
    // S6 후속 「다가오는 일정」(23-8-4): 일정(ends_on ≥ from && starts_on ≤ to, 게임 무관 포함) + 내전([now, scrimBefore), 취소 제외), 각 MAX + 1개 → core 병합
    const w = upcomingWindow(nowD, ADMIN_UPCOMING_DAYS);
    const upEvents = (empty ? [] : st.events)
      .filter((e) => e.ends_on >= w.from && e.starts_on <= w.to)
      .sort(eventOrder)
      .slice(0, ADMIN_UPCOMING_MAX + 1)
      .map(eventItem);
    const upScrims = (empty ? [] : st.scrims)
      .filter((s) => s.status !== 'cancelled' && Date.parse(s.scheduled_at) >= now && Date.parse(s.scheduled_at) < w.scrimBefore.getTime())
      .sort(byScheduled)
      .slice(0, ADMIN_UPCOMING_MAX + 1)
      .map((s) => scrimItem(s.id));
    const merged = mergeUpcomingItems(upEvents, upScrims, ADMIN_UPCOMING_MAX);
    const upcoming: AdminUpcoming = { from: w.from, to: w.to, items: merged.items, has_more: merged.hasMore };
    const res: AdminOverview = {
      generated_at: iso(now),
      week_start: week.start.toISOString(),
      month_start: month.start.toISOString(),
      members: { total: users.length, active: users.filter((u) => !u.left_at).length, admins: users.filter((u) => u.role === 'admin').length },
      scrims_this_week: st.scrims.filter((s) => inRange(s.scheduled_at, week) && s.status !== 'cancelled').length,
      pending_results: {
        count: pending.length,
        oldest_submitted_at: pending.length ? iso(Math.min(...pending.map((r) => Date.parse(r.created_at)))) : null,
      },
      no_shows: {
        this_month: st.players.filter((p) => p.status === 'no_show' && inRange(p.no_show_marked_at, month)).length,
        last_month: st.players.filter((p) => p.status === 'no_show' && inRange(p.no_show_marked_at, last)).length,
      },
      restricted_members: {
        count: restricted.length,
        next_release_at: restricted.length ? iso(Math.min(...restricted.map((r) => r.until!.getTime()))) : null,
      },
      ranking_cache: { last_computed_at: ctx.rankingSyncedAt(), failing_keys: ctx.rankingStale ? 2 : 0 },
      upcoming,
    };
    return json(200, res);
  }

  // ---- 결과 큐 ----
  if (method === 'GET' && path === ApiPath.adminResults) {
    const p = ListAdminResultsQuery.safeParse(q);
    if (!p.success) return bad(p.error);
    const view = p.data.view;
    const cutoff = now - SCRIM_RESULT_REVERT_WINDOW_DAYS * DAY_MS;
    let rows = empty ? [] : st.results.filter((r) => st.scrims.some((s) => s.id === r.scrim_id));
    if (view === 'pending') rows = rows.filter((r) => r.status === 'pending').sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || (a.id < b.id ? -1 : 1));
    else
      rows = rows
        .filter((r) => r.status === 'approved' && r.approved_at && Date.parse(r.approved_at) >= cutoff)
        .sort((a, b) => Date.parse(b.approved_at!) - Date.parse(a.approved_at!) || (a.id < b.id ? 1 : -1));
    const items: AdminResultItem[] = rows.map((r) => {
      const s = st.scrims.find((x) => x.id === r.scrim_id)!;
      const first = r.placements?.find((x) => x.placement === 1);
      const block = r.status === 'approved' ? mockRevertBlock(st, r, me.id, now) : null;
      return {
        result_id: r.id,
        status: r.status,
        scrim: { ...scrimRef(s), started_at: s.started_at, rated: s.rated, host: ctx.userRef(s.host_id) },
        outcome: { winner_team: r.winner_team, winner: first ? ctx.userRef(first.user_id) : null },
        submitted_by: ctx.userRef(r.submitted_by),
        submitted_at: r.created_at,
        approved_by: r.approved_by ? ctx.userRef(r.approved_by) : null,
        approved_at: r.approved_at,
        rating_status: ratingStatusOf(st, r, s.rated),
        can_review: r.status === 'pending' && r.submitted_by !== me.id,
        can_revert: r.status === 'approved' && block === null,
        revert_blocked_reason: block,
      };
    });
    return reply(page(items, `results:${view}`));
  }

  // ---- 노쇼 후보 ----
  if (method === 'GET' && path === ApiPath.adminNoShowScrims) {
    const p = ListAdminNoShowScrimsQuery.safeParse(q);
    if (!p.success) return bad(p.error);
    const rows = (empty ? [] : st.scrims)
      .filter((s) => (s.status === 'playing' || s.status === 'finished') && isNoShowMarkWindowOpen(new Date(s.scheduled_at), new Date(now), ctx.markWindowDays))
      .sort((a, b) => Date.parse(b.scheduled_at) - Date.parse(a.scheduled_at) || (a.id < b.id ? 1 : -1));
    const items: AdminNoShowScrim[] = rows.map((s) => ({
      ...scrimRef(s),
      status: s.status as 'playing' | 'finished',
      mark_deadline: iso(Date.parse(s.scheduled_at) + ctx.markWindowDays * DAY_MS),
      players: ctx.slotRows(s.id).map((pl) => {
        const marks = marksOf(pl.user_id);
        const r = computeScrimRestriction(marks, new Date(now), policy);
        return {
          user: ctx.userRef(pl.user_id),
          status: pl.status as 'joined' | 'no_show',
          no_show_count_30d: r.recentCount,
          restricted_until: r.restricted && r.until ? r.until.toISOString() : null,
          restrict_if_marked: pl.status === 'joined' && previewNoShowRestriction(marks, new Date(now), policy).newlyRestricted,
        };
      }),
    }));
    return reply(page(items, 'no-show'), {
      policy: { threshold: policy.threshold, window_days: policy.windowDays, restriction_days: policy.restrictionDays, mark_window_days: ctx.markWindowDays },
    });
  }

  // ---- 멤버 ----
  function memberRows() {
    const meta = new Map(st.members.map((x) => [x.user_id, x]));
    const meRow = {
      id: me.id,
      role: me.role,
      role_locked: false,
      discord_username: isLinkedDiscordId(me.discord_id) ? me.discord_username : null,
      joined_at: me.created_at,
      last_login_at: iso(now),
      left_at: null as string | null,
    };
    return [
      meRow,
      ...ctx.users.flatMap((u) => {
        if (st.deleted_user_ids.includes(u.id)) return [];
        const x: MockMemberMeta | undefined = meta.get(u.id);
        return x ? [{ id: u.id, role: x.role, role_locked: x.role_locked, discord_username: x.discord_username, joined_at: x.joined_at, last_login_at: x.last_login_at, left_at: x.left_at }] : [];
      }),
    ];
  }
  const scrimCount = (userId: string) =>
    st.players.filter(
      (p) => p.user_id === userId && p.status === 'joined' && st.results.some((r) => r.scrim_id === p.scrim_id && r.status === 'approved') && st.scrims.find((s) => s.id === p.scrim_id)?.status !== 'cancelled',
    ).length;
  const memberItem = (u: ReturnType<typeof memberRows>[number]): AdminMemberItem => {
    const r = restrictionOf(u.id);
    const until = r.restricted && r.until ? r.until : null;
    return {
      user: ctx.userRef(u.id),
      role: u.role,
      role_locked: u.role_locked,
      discord_linked: u.discord_username !== null,
      discord_username: u.discord_username,
      joined_at: u.joined_at,
      last_login_at: u.last_login_at,
      scrim_count: scrimCount(u.id),
      no_show_30d: r.recentCount,
      restricted_until: until ? until.toISOString() : null,
      left_at: u.left_at,
      status: adminMemberStatus({ leftAt: u.left_at ? new Date(u.left_at) : null, restrictedUntil: until, now: new Date(now) }),
    };
  };
  if (method === 'GET' && path === ApiPath.adminMembers) {
    const p = ListAdminMembersQuery.safeParse(q);
    if (!p.success) return bad(p.error);
    const needle = p.data.q?.toLowerCase();
    const rows = memberRows()
      .map(memberItem)
      .filter((x) => (!p.data.role || x.role === p.data.role) && (!needle || x.user.nickname.toLowerCase().includes(needle) || (x.discord_username ?? '').toLowerCase().includes(needle)));
    const idAsc = (a: AdminMemberItem, b: AdminMemberItem) => (a.user.id < b.user.id ? -1 : 1);
    const cmp: Record<typeof p.data.sort, (a: AdminMemberItem, b: AdminMemberItem) => number> = {
      joined_desc: (a, b) => Date.parse(b.joined_at) - Date.parse(a.joined_at) || idAsc(a, b),
      nickname_asc: (a, b) => a.user.nickname.localeCompare(b.user.nickname, 'ko') || idAsc(a, b),
      scrims_desc: (a, b) => b.scrim_count - a.scrim_count || idAsc(a, b),
      no_show_desc: (a, b) => b.no_show_30d - a.no_show_30d || idAsc(a, b),
      last_login_desc: (a, b) => (b.last_login_at ? Date.parse(b.last_login_at) : -Infinity) - (a.last_login_at ? Date.parse(a.last_login_at) : -Infinity) || idAsc(a, b),
    };
    return reply(page(rows.sort(cmp[p.data.sort]), p.data.sort));
  }
  m = match(ApiPath.adminMemberRole, path);
  if (m && method === 'PATCH') {
    if (!AdminIdParams.safeParse(m).success) return error('VALIDATION_FAILED', 'id 형식', { details: [{ path: 'id', message: 'uuid' }] });
    const p = ChangeMemberRoleRequest.safeParse(ctx.body);
    if (!p.success) return bad(p.error);
    const rows = memberRows();
    const target = rows.find((x) => x.id === m!.id);
    if (!target) return error('NOT_FOUND', '회원 없음');
    const plan = planRoleChange({
      actorId: me.id,
      targetId: target.id,
      currentRole: target.role,
      nextRole: p.data.role,
      targetLocked: target.role_locked,
      adminCount: rows.filter((x) => x.role === 'admin').length,
    });
    if (plan.kind === 'error') return error(plan.code, plan.code);
    if (plan.kind === 'change') {
      const meta = st.members.find((x) => x.user_id === target.id)!;
      meta.role = p.data.role;
      const nick = ctx.userRef(target.id).nickname;
      audit('member.role_change', target.id, `${nick} 역할을 ${p.data.role === 'admin' ? '운영진으로' : '멤버로'} 변경`, { from: target.role, to: p.data.role });
      ctx.persist();
    }
    return json(200, memberItem(memberRows().find((x) => x.id === target.id)!));
  }
  m = match(ApiPath.adminMember, path);
  if (m && method === 'DELETE') {
    if (!AdminIdParams.safeParse(m).success) return error('VALIDATION_FAILED', 'id 형식', { details: [{ path: 'id', message: 'uuid' }] });
    const target = memberRows().find((x) => x.id === m!.id);
    if (!target) return error('NOT_FOUND', '회원 없음');
    if (target.role === 'admin') return error('ADMIN_DELETE_ADMIN', 'ADMIN_DELETE_ADMIN');
    const hasHistory =
      st.players.some((p) => p.user_id === target.id) ||
      st.scrims.some((s) => s.host_id === target.id) ||
      st.results.some((r) => [r.submitted_by, r.approved_by, r.rejected_by, r.reverted_by].includes(target.id));
    if (hasHistory) return error('ADMIN_MEMBER_HAS_HISTORY', 'ADMIN_MEMBER_HAS_HISTORY');
    const nick = ctx.userRef(target.id).nickname;
    st.deleted_user_ids.push(target.id);
    st.members = st.members.filter((x) => x.user_id !== target.id);
    audit('member.delete', target.id, `${nick} 회원 삭제`, { id: target.id, nickname: nick, role: target.role });
    ctx.persist();
    return json(204, null);
  }

  // ---- 공지 ----
  const idOk = (mm: Record<string, string>) => AdminIdParams.safeParse(mm).success;
  const idBad = () => error('VALIDATION_FAILED', 'id 형식', { details: [{ path: 'id', message: 'uuid' }] });
  const notifiedConflict = (cur: { notify_discord: boolean; discord_notified_at: string | null }, next: boolean | undefined) =>
    next !== undefined && next !== cur.notify_discord && cur.discord_notified_at !== null;

  if (method === 'POST' && path === ApiPath.adminNotices) {
    const p = CreateNoticeRequest.safeParse(ctx.body);
    if (!p.success) return bad(p.error);
    const n: MockNotice = { id: crypto.randomUUID(), ...p.data, author_id: me.id, discord_notified_at: null, created_at: iso(now), updated_at: iso(now) };
    st.notices.push(n);
    audit('notice.create', n.id, `공지 '${quote(n.title)}' 작성`, { title: n.title, body: n.body, notify_discord: n.notify_discord });
    ctx.persist();
    return json(201, noticeView(n));
  }
  m = match(ApiPath.adminNotice, path);
  if (m && (method === 'PATCH' || method === 'DELETE')) {
    if (!idOk(m)) return idBad();
    const n = st.notices.find((x) => x.id === m!.id);
    if (method === 'DELETE') {
      if (!n) return error('NOT_FOUND', '공지 없음');
      st.notices = st.notices.filter((x) => x.id !== n.id);
      audit('notice.delete', n.id, `공지 '${quote(n.title)}' 삭제`, { ...n });
      ctx.persist();
      return json(204, null);
    }
    const p = UpdateNoticeRequest.safeParse(ctx.body);
    if (!p.success) return bad(p.error);
    if (!n) return error('NOT_FOUND', '공지 없음');
    if (notifiedConflict(n, p.data.notify_discord)) return error('DISCORD_ALREADY_NOTIFIED', '이미 전송됨');
    const { before, after } = diff(n, p.data);
    Object.assign(n, p.data, Object.keys(after).length ? { updated_at: iso(now) } : {});
    if (Object.keys(after).length) audit('notice.update', n.id, `공지 '${quote(n.title)}' 수정`, { before, after });
    ctx.persist();
    return json(200, noticeView(n));
  }

  // ---- 패치노트 ----
  if (method === 'POST' && path === ApiPath.adminPatchNotes) {
    const p = CreatePatchNoteRequest.safeParse(ctx.body);
    if (!p.success) return bad(p.error);
    const n: MockPatchNote = { id: crypto.randomUUID(), ...p.data, discord_notified_at: null, auto_registered: false, created_by: me.id, created_at: iso(now), updated_at: iso(now) };
    st.patch_notes.push(n);
    audit('patch_note.create', n.id, `패치노트 '${quote(n.title)}' 작성`, { ...p.data });
    ctx.persist();
    return json(201, patchView(n));
  }
  m = match(ApiPath.adminPatchNote, path);
  if (m && (method === 'PATCH' || method === 'DELETE')) {
    if (!idOk(m)) return idBad();
    const n = st.patch_notes.find((x) => x.id === m!.id);
    if (method === 'DELETE') {
      if (!n) return error('NOT_FOUND', '패치노트 없음');
      st.patch_notes = st.patch_notes.filter((x) => x.id !== n.id);
      audit('patch_note.delete', n.id, `패치노트 '${quote(n.title)}' 삭제`, { ...n });
      ctx.persist();
      return json(204, null);
    }
    const p = UpdatePatchNoteRequest.safeParse(ctx.body);
    if (!p.success) return bad(p.error);
    if (!n) return error('NOT_FOUND', '패치노트 없음');
    if (notifiedConflict(n, p.data.notify_discord)) return error('DISCORD_ALREADY_NOTIFIED', '이미 전송됨');
    const { before, after } = diff(n, p.data);
    Object.assign(n, p.data, Object.keys(after).length ? { updated_at: iso(now) } : {});
    if (Object.keys(after).length) audit('patch_note.update', n.id, `패치노트 '${quote(n.title)}' 수정`, { before, after });
    ctx.persist();
    return json(200, patchView(n));
  }

  // ---- 이벤트 ----
  if (method === 'POST' && path === ApiPath.adminEvents) {
    const p = CreateEventRequest.safeParse(ctx.body);
    if (!p.success) return bad(p.error);
    const e: MockEvent = { id: crypto.randomUUID(), ...p.data, created_by: me.id, created_at: iso(now), updated_at: iso(now) };
    st.events.push(e);
    audit('event.create', e.id, `이벤트 '${quote(e.title)}' 작성`, { ...p.data });
    ctx.persist();
    return json(201, eventView(e));
  }
  m = match(ApiPath.adminEvent, path);
  if (m && (method === 'PATCH' || method === 'DELETE')) {
    if (!idOk(m)) return idBad();
    const e = st.events.find((x) => x.id === m!.id);
    if (method === 'DELETE') {
      if (!e) return error('NOT_FOUND', '이벤트 없음');
      st.events = st.events.filter((x) => x.id !== e.id);
      audit('event.delete', e.id, `이벤트 '${quote(e.title)}' 삭제`, { ...e });
      ctx.persist();
      return json(204, null);
    }
    const p = UpdateEventRequest.safeParse(ctx.body);
    if (!p.success) return bad(p.error);
    if (!e) return error('NOT_FOUND', '이벤트 없음');
    // 저장값과 합친 4필드를 서버와 같은 shared 규칙으로 다시 검사한다(D300: 생략 = 그대로, null = 비우기)
    const scheduleIssues = eventScheduleIssues({
      starts_on: p.data.starts_on ?? e.starts_on,
      ends_on: p.data.ends_on ?? e.ends_on,
      start_time: p.data.start_time !== undefined ? p.data.start_time : e.start_time,
      end_time: p.data.end_time !== undefined ? p.data.end_time : e.end_time,
    });
    if (scheduleIssues.length > 0) {
      return error('VALIDATION_FAILED', '일정 기간·시각', { details: scheduleIssues.map(({ path: ip, message }) => ({ path: ip, message })) });
    }
    const { before, after } = diff(e, p.data);
    Object.assign(e, p.data, Object.keys(after).length ? { updated_at: iso(now) } : {});
    if (Object.keys(after).length) audit('event.update', e.id, `이벤트 '${quote(e.title)}' 수정`, { before, after });
    ctx.persist();
    return json(200, eventView(e));
  }

  // ---- API 키 ----
  const keyView = (k: MockApiKey): AdminApiKeyItem => ({ ...k, created_by: k.created_by ? ctx.userRef(k.created_by) : null });
  if (path === ApiPath.adminApiKeys && method === 'GET') {
    const rows = (empty ? [] : [...st.api_keys]).sort((a, b) => (a.revoked_at ? 1 : 0) - (b.revoked_at ? 1 : 0) || byCreatedDesc(a, b));
    return json(200, { items: rows.map(keyView), next_cursor: null });
  }
  if (path === ApiPath.adminApiKeys && method === 'POST') {
    const p = CreateApiKeyRequest.safeParse(ctx.body);
    if (!p.success) return bad(p.error);
    const raw = `${API_KEY_PREFIX}${randomBase64Url(43)}`;
    const k: MockApiKey = {
      id: crypto.randomUUID(),
      name: p.data.name,
      key_prefix: raw.slice(API_KEY_PREFIX.length, API_KEY_PREFIX.length + API_KEY_DISPLAY_PREFIX_LENGTH),
      scopes: p.data.scopes,
      last_used_at: null,
      revoked_at: null,
      created_by: me.id,
      created_at: iso(now),
    };
    st.api_keys.push(k);
    audit('api_key.create', k.id, `API 키 '${quote(k.name)}' 발급`, { name: k.name, key_prefix: k.key_prefix, scopes: k.scopes });
    ctx.persist();
    return json(201, { api_key: keyView(k), key: raw });
  }
  m = match(ApiPath.adminApiKeyRevoke, path);
  if (m && method === 'POST') {
    if (!idOk(m)) return idBad();
    const k = st.api_keys.find((x) => x.id === m!.id);
    if (!k) return error('NOT_FOUND', '키 없음');
    if (!k.revoked_at) {
      k.revoked_at = iso(now);
      audit('api_key.revoke', k.id, `API 키 '${quote(k.name)}' 폐기`, { name: k.name, key_prefix: k.key_prefix });
      ctx.persist();
    }
    return json(200, keyView(k));
  }

  // ---- 시즌 ----
  const like = (s: MockSeason) => ({ id: s.id, startsAt: new Date(s.starts_at), endsAt: new Date(s.ends_at), closedAt: (() => {
    const c = mockSeasonClosedAt(s, now);
    return c ? new Date(c) : null;
  })() });
  const seasonView = (s: MockSeason): AdminSeasonItem => {
    const phase = seasonPhase(like(s), new Date(now));
    const e = seasonEditable(phase);
    const cur = currentSeason(st, now);
    return {
      id: s.id,
      name: s.name,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      is_current: cur?.id === s.id,
      phase,
      closed_at: mockSeasonClosedAt(s, now),
      rated_games: new Set(st.history.filter((h) => h.season_id === s.id).map((h) => h.scrim_id)).size,
      editable: { name: e.name, starts_at: e.startsAt, ends_at: e.endsAt, delete: e.delete },
    };
  };
  const seasonPolicy = { minLeadMs: SEASON_EDIT_MIN_LEAD_SEC * 1000, minLengthMs: SEASON_LENGTH_MIN_DAYS * DAY_MS, maxLengthMs: SEASON_LENGTH_MAX_DAYS * DAY_MS };
  const seasonIssues = (list: ReturnType<typeof validateSeasonWrite>): Response | null => {
    const ne = list.filter((x) => x.kind === 'not_editable');
    if (ne.length) return error('SEASON_NOT_EDITABLE', '수정 불가');
    const inv = list.flatMap((x) => (x.kind === 'invalid' ? [{ path: x.path, message: x.message }] : []));
    if (inv.length) return error('VALIDATION_FAILED', '시즌 값', { details: inv });
    if (list.some((x) => x.kind === 'overlap')) return error('SEASON_OVERLAP', '겹침');
    return null;
  };
  if (path === ApiPath.adminSeasons && method === 'GET') {
    const rows = [...st.seasons].sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at) || (a.id < b.id ? -1 : 1));
    return json(200, { items: rows.map(seasonView), next_cursor: null });
  }
  if (path === ApiPath.adminSeasons && method === 'POST') {
    const p = CreateSeasonRequest.safeParse(ctx.body);
    if (!p.success) return bad(p.error);
    const next = { startsAt: new Date(p.data.starts_at), endsAt: new Date(p.data.ends_at) };
    const r = seasonIssues(validateSeasonWrite({ seasons: st.seasons.map(like), target: null, next, changed: { startsAt: true, endsAt: true }, now: new Date(now), policy: seasonPolicy }));
    if (r) return r;
    const s: MockSeason = { id: crypto.randomUUID(), name: p.data.name, starts_at: next.startsAt.toISOString(), ends_at: next.endsAt.toISOString() };
    st.seasons.push(s);
    audit('season.create', s.id, `시즌 '${quote(s.name)}' 생성`, { name: s.name, starts_at: s.starts_at, ends_at: s.ends_at });
    ctx.persist();
    return json(201, seasonView(s));
  }
  m = match(ApiPath.adminSeason, path);
  if (m && (method === 'PATCH' || method === 'DELETE')) {
    if (!idOk(m)) return idBad();
    const s = st.seasons.find((x) => x.id === m!.id);
    if (method === 'DELETE') {
      if (!s) return error('NOT_FOUND', '시즌 없음');
      if (validateSeasonDelete(like(s), new Date(now)).length) return error('SEASON_NOT_EDITABLE', '삭제 불가');
      st.seasons = st.seasons.filter((x) => x.id !== s.id);
      audit('season.delete', s.id, `시즌 '${quote(s.name)}' 삭제`, { ...s });
      ctx.persist();
      return json(204, null);
    }
    const p = UpdateSeasonRequest.safeParse(ctx.body);
    if (!p.success) return bad(p.error);
    if (!s) return error('NOT_FOUND', '시즌 없음');
    const next = { startsAt: new Date(p.data.starts_at ?? s.starts_at), endsAt: new Date(p.data.ends_at ?? s.ends_at) };
    const changed = {
      startsAt: p.data.starts_at !== undefined && next.startsAt.getTime() !== Date.parse(s.starts_at),
      endsAt: p.data.ends_at !== undefined && next.endsAt.getTime() !== Date.parse(s.ends_at),
    };
    const r = seasonIssues(validateSeasonWrite({ seasons: st.seasons.map(like), target: like(s), next, changed, now: new Date(now), policy: seasonPolicy }));
    if (r) return r;
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (p.data.name !== undefined && p.data.name !== s.name) {
      before.name = s.name;
      after.name = p.data.name;
    }
    if (changed.startsAt) {
      before.starts_at = s.starts_at;
      after.starts_at = next.startsAt.toISOString();
    }
    if (changed.endsAt) {
      before.ends_at = s.ends_at;
      after.ends_at = next.endsAt.toISOString();
    }
    Object.assign(s, { name: p.data.name ?? s.name, starts_at: next.startsAt.toISOString(), ends_at: next.endsAt.toISOString() });
    if (Object.keys(after).length) {
      audit('season.update', s.id, `시즌 '${quote(s.name)}' 수정`, { before, after });
      ctx.persist();
    }
    return json(200, seasonView(s));
  }

  // ---- 감사 로그 ----
  if (method === 'GET' && path === ApiPath.adminAuditLogs) {
    const p = ListAdminAuditLogsQuery.safeParse(q);
    if (!p.success) return bad(p.error);
    const rows = (empty ? [] : st.audit).filter((a) => !p.data.action || a.action === p.data.action).sort(byCreatedDesc);
    const items: AdminAuditLogItem[] = rows.map((a) => ({
      id: a.id,
      actor: a.actor_id ? ctx.userRef(a.actor_id) : null,
      action: a.action,
      target_type: ADMIN_AUDIT_TARGET_BY_ACTION[a.action],
      target_id: a.target_id,
      summary: a.summary,
      details: a.details,
      created_at: a.created_at,
    }));
    return reply(page(items, `audit:${p.data.action ?? ''}`));
  }

  return error('NOT_FOUND', `목에 없는 경로: ${method} ${path}`);
}

/** 바뀐 필드만 before/after(감사 details, 10-2) */
function diff<T extends Record<string, unknown>>(cur: T, patch: Partial<T>): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && v !== cur[k]) {
      before[k] = cur[k];
      after[k] = v;
    }
  }
  return { before, after };
}

function randomBase64Url(len: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => alphabet[b % 64]).join('');
}
