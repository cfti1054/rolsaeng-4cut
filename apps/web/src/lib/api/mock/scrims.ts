import {
  ApiPath,
  CreateScrimRequest,
  GAME_SEED,
  GameCode,
  IsoDateTime,
  JoinScrimRequest,
  ListScrimsQuery,
  NO_SHOW_MARK_WINDOW_DAYS_DEFAULT,
  NO_SHOW_RESTRICTION_DAYS_DEFAULT,
  NO_SHOW_THRESHOLD_DEFAULT,
  NO_SHOW_WINDOW_DAYS_DEFAULT,
  SCRIM_AUTO_CLOSE_AFTER_MIN_DEFAULT,
  SCRIM_MIN_PLAYERS_TO_START,
  SCRIM_SCHEDULE_MAX_DAYS_AHEAD_DEFAULT,
  ScrimCancelReason,
  ScrimDetail,
  ScrimPlayerStatus,
  ScrimRestriction,
  ScrimStatus,
  ScrimSummary,
  SearchSteamAppsQuery,
  SetScrimNoShowRequest,
  STEAM_APP_SEARCH_LIMIT,
  SteamAppRef,
  UpdateScrimRequest,
  Uuid,
  type ErrorCode,
  type SearchSteamAppsResponse,
  type SteamAppOption,
  type GameSeed,
  type GameView,
  type ListGamesResponse,
  type ListScrimsResponse,
  type Me,
  type OpenPosition,
  type ScrimUserRef,
} from '@gcd/shared';
import { z } from 'zod';
import { MOCK_OTHER_MEMBER_ID } from './game-accounts';

/**
 * [목] S2 내전 엔드포인트 11개(계약 4·5절). backend.ts가 인증을 끝낸 뒤 이 핸들러를 부른다.
 * 서버 흐름을 같은 순서로 흉내 낸다: 상태 → join_closed → 포지션 검증 → 이미 참가(포지션 변경) → 노쇼 제한 → 배치.
 * core 함수(packages/core)는 web 의존성이 아니어서 같은 규칙을 이 파일에 작게 다시 적었다.
 *
 * 시드(요청한 사용자 기준으로 처음 한 번): 모집 중 13개(마지막 페이지 「더 보기」 확인용), 시작 대기 1개, 진행 중·종료·취소 각 1개.
 * - 「주말 협곡 2판 연속」은 내가 방장(정원 마감 + 대기 2명) → 방장 메뉴·시작 확인
 * - 「골드 이하 초보 환영 내전」은 내가 참가 중 → 참가 취소·포지션 변경 확인
 * - 진행 중 내전에 내가 참가 → 운영진(dev-login role admin)이면 노쇼 표시 확인
 * - 닉네임이 `noshow`로 시작하면 최근 노쇼 3회를 심어 제한 상태를 만든다(dev-login username noshow…)
 */

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

const MockScrim = z.object({
  id: Uuid,
  game: GameCode,
  title: z.string(),
  scheduled_at: IsoDateTime,
  capacity: z.number().int(),
  status: ScrimStatus,
  host_id: Uuid,
  rules: z.string().nullable(),
  rated: z.boolean(),
  auto_balance: z.boolean(),
  use_positions: z.boolean(),
  /** 이 필드 전에 저장된 목 DB도 읽히도록 기본 null */
  steam_app: SteamAppRef.nullable().default(null),
  started_at: IsoDateTime.nullable(),
  cancelled_at: IsoDateTime.nullable(),
  cancel_reason: ScrimCancelReason.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
type MockScrim = z.infer<typeof MockScrim>;

/**
 * 스팀 게임 목(D98). owner_count > 0 = 멤버 보유 게임(검색어 없을 때 목록), 나머지는 상점에만 있는 게임.
 * 검색어에 「상점오류」가 들어가면 상점 검색 실패(store_unavailable)를 흉내 낸다.
 */
export const MOCK_STEAM_APPS: readonly SteamAppOption[] = [
  { app_id: 578080, name: 'PUBG: BATTLEGROUNDS', owner_count: 9 },
  { app_id: 730, name: 'Counter-Strike 2', owner_count: 7 },
  { app_id: 1966720, name: 'Lethal Company', owner_count: 6 },
  { app_id: 945360, name: 'Among Us', owner_count: 5 },
  { app_id: 1172470, name: 'Apex Legends', owner_count: 4 },
  { app_id: 553850, name: 'HELLDIVERS 2', owner_count: 4 },
  { app_id: 892970, name: 'Valheim', owner_count: 3 },
  { app_id: 739630, name: 'Phasmophobia', owner_count: 3 },
  { app_id: 548430, name: 'Deep Rock Galactic', owner_count: 2 },
  { app_id: 1426210, name: 'It Takes Two', owner_count: 2 },
  { app_id: 570, name: 'Dota 2', owner_count: 1 },
  { app_id: 550, name: 'Left 4 Dead 2', owner_count: 1 },
  { app_id: 1623730, name: 'Palworld', owner_count: 0 },
  { app_id: 728880, name: 'Overcooked! 2', owner_count: 0 },
  { app_id: 413150, name: 'Stardew Valley', owner_count: 0 },
  { app_id: 105600, name: 'Terraria', owner_count: 0 },
  { app_id: 2881650, name: 'Content Warning', owner_count: 0 },
  { app_id: 1172620, name: 'Sea of Thieves', owner_count: 0 },
];
const steamApp = (id: number): SteamAppRef | null => {
  const a = MOCK_STEAM_APPS.find((x) => x.app_id === id);
  return a ? { app_id: a.app_id, name: a.name } : null;
};

const MockPlayer = z.object({
  id: Uuid,
  scrim_id: Uuid,
  user_id: Uuid,
  status: ScrimPlayerStatus,
  preferred_positions: z.array(z.string()),
  joined_at: IsoDateTime,
  no_show_marked_at: IsoDateTime.nullable(),
  no_show_marked_by: Uuid.nullable(),
});
type MockPlayer = z.infer<typeof MockPlayer>;

export const MockS2State = z.object({
  /** 시드를 만든 사용자 id. 다른 사용자로 로그인하면 다시 만든다 */
  owner: z.string(),
  scrims: z.array(MockScrim),
  players: z.array(MockPlayer),
});
export type MockS2State = z.infer<typeof MockS2State>;

export const emptyS2State = (): MockS2State => ({ owner: '', scrims: [], players: [] });

export interface MockS2Options {
  noShowPolicy?: { threshold: number; windowDays: number; restrictionDays: number };
}

export interface MockS2Context {
  method: string;
  path: string;
  search: URLSearchParams;
  body: unknown;
  me: Me;
  now: number;
  state: MockS2State;
  save: (s: MockS2State) => void;
  json: (status: number, body: unknown) => Response;
  error: (code: ErrorCode, message: string, opts?: { retryAfterSec?: number; details?: { path: string; message: string }[] }) => Response;
  opts?: MockS2Options;
}

// -----------------------------------------------------------------------------
// 고정 데이터
// -----------------------------------------------------------------------------

const uid = (n: number) => `5c0f0000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** 다른 멤버(공개 정보만). 정글차이는 S1 목 프로필과 같은 id라 프로필 링크가 열린다 */
export const MOCK_SCRIM_USERS: readonly ScrimUserRef[] = [
  { id: uid(1), nickname: '미드고정', avatar_url: null },
  { id: MOCK_OTHER_MEMBER_ID, nickname: '정글차이', avatar_url: null },
  { id: uid(3), nickname: '원딜장인', avatar_url: null },
  { id: uid(4), nickname: '서폿요정', avatar_url: null },
  { id: uid(5), nickname: '한타각', avatar_url: null },
  { id: uid(6), nickname: '바론스틸', avatar_url: null },
  { id: uid(7), nickname: '별빛미드', avatar_url: null },
  { id: uid(8), nickname: '무한점멸', avatar_url: null },
  { id: uid(9), nickname: '와드지기', avatar_url: null },
  { id: uid(10), nickname: '칼바람러', avatar_url: null },
  { id: uid(11), nickname: '용용이', avatar_url: null },
  { id: uid(12), nickname: '체스왕', avatar_url: null },
];
const U = Object.fromEntries(MOCK_SCRIM_USERS.map((u) => [u.nickname, u.id])) as Record<string, string>;

export function mockGames(): GameView[] {
  return [...GAME_SEED]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((g) => ({
      code: g.code,
      name: g.name,
      has_positions: g.has_positions,
      has_teams: g.has_teams,
      positions: [...g.positions],
      sort_order: g.sort_order,
      capacity: {
        min: g.capacity_min,
        max: g.capacity_max,
        default: g.capacity_default,
        step: g.capacity_step,
        start_requires_full: g.start_requires_full,
      },
      requires_steam_app: g.requires_steam_app,
    }));
}

const gameOf = (code: GameCode): GameSeed => GAME_SEED.find((g) => g.code === code)!;

// -----------------------------------------------------------------------------
// 규칙(core와 같은 규칙의 작은 복사본, 계약 7절)
// -----------------------------------------------------------------------------

const iso = (t: number) => new Date(t).toISOString();
const isOpen = (s: { status: string }) => s.status === 'recruiting' || s.status === 'full';
const isClosed = (s: MockScrim, now: number) => now >= Date.parse(s.scheduled_at);

function orderWaitlist<T extends { id: string; joined_at: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => Date.parse(a.joined_at) - Date.parse(b.joined_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function validatePositions(input: readonly string[], positions: readonly string[], use: boolean): string | null {
  if (!use) return input.length === 0 ? null : '포지션을 받지 않는 내전이에요';
  if (input.length < 1 || input.length > 2) return '1지망은 꼭 골라야 해요';
  if (new Set(input).size !== input.length) return '같은 포지션을 두 번 고를 수 없어요';
  if (input.some((p) => !positions.includes(p))) return '이 게임에 없는 포지션이에요';
  return null;
}

function computeOpenPositions(positions: readonly string[], capacity: number, firstChoices: readonly (string | null)[]): OpenPosition[] {
  if (capacity - firstChoices.length <= 0 || positions.length === 0 || capacity % positions.length !== 0) return [];
  const per = capacity / positions.length;
  return positions
    .map((position) => ({ position, count: per - firstChoices.filter((f) => f === position).length }))
    .filter((o) => o.count >= 1);
}

function computeRestriction(marks: readonly number[], now: number, policy: Required<MockS2Options>['noShowPolicy']) {
  const win = policy.windowDays * DAY_MS;
  const valid = marks.filter((m) => m <= now).sort((a, b) => a - b);
  let until: number | null = null;
  for (const m of valid) {
    const n = valid.filter((x) => x > m - win && x <= m).length;
    if (n >= policy.threshold) until = Math.max(until ?? 0, m + policy.restrictionDays * DAY_MS);
  }
  const restricted = until !== null && now < until;
  return {
    restricted,
    until: restricted ? until : null,
    recentCount: valid.filter((x) => x > now - win).length,
    last: valid.length ? valid[valid.length - 1]! : null,
  };
}

// -----------------------------------------------------------------------------
// 시드
// -----------------------------------------------------------------------------

function seed(me: Me, now: number): MockS2State {
  const state: MockS2State = { owner: me.id, scrims: [], players: [] };
  let n = 0;
  const id = () => {
    n += 1;
    return `5c1a0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  };
  const steamPicks = [578080, 1966720, 730, 945360, 553850, 739630];
  let steamPick = 0;
  const add = (
    s: Partial<MockScrim> & Pick<MockScrim, 'game' | 'title' | 'scheduled_at' | 'capacity' | 'host_id'>,
    joined: [string, string[]][],
    waitlist: [string, string[]][] = [],
  ) => {
    const game = gameOf(s.game);
    const scrimId = id();
    const created = Date.parse(s.scheduled_at) - 2 * DAY_MS;
    const scrim: MockScrim = {
      id: scrimId,
      status: 'recruiting',
      rules: null,
      rated: true,
      auto_balance: game.has_teams,
      use_positions: game.has_positions,
      steam_app: game.requires_steam_app ? steamApp(steamPicks[steamPick++ % steamPicks.length]!) : null,
      started_at: null,
      cancelled_at: null,
      cancel_reason: null,
      created_at: iso(Math.min(created, now)),
      updated_at: iso(Math.min(created, now)),
      ...s,
    };
    let t = Date.parse(scrim.created_at);
    for (const [userId, pos] of [...joined, ...waitlist]) {
      t += 7 * MIN_MS;
      const isWait = waitlist.some(([u]) => u === userId);
      state.players.push({
        id: id(),
        scrim_id: scrimId,
        user_id: userId,
        status: isWait ? 'waitlist' : 'joined',
        preferred_positions: scrim.use_positions ? pos : [],
        joined_at: iso(Math.min(t, now - MIN_MS)),
        no_show_marked_at: null,
        no_show_marked_by: null,
      });
    }
    if (isOpen(scrim)) scrim.status = joined.length >= scrim.capacity ? 'full' : 'recruiting';
    state.scrims.push(scrim);
    return scrim;
  };
  const h = (hours: number) => iso(Math.ceil((now + hours * 3_600_000) / (30 * MIN_MS)) * 30 * MIN_MS);

  add(
    { game: 'lol', title: '화요일 저녁 5:5 내전', scheduled_at: h(3), capacity: 10, host_id: U['미드고정']!, rules: '토너먼트 드래프트, 피어리스 없음.\n시작 10분 전까지 음성 채널 입장.\n노쇼 3회(30일) 시 1일간 참가 제한.' },
    [
      [U['미드고정']!, ['mid', 'top']],
      [U['한타각']!, ['top', 'jungle']],
      [U['원딜장인']!, ['bot', 'support']],
      [U['별빛미드']!, ['mid', 'bot']],
      [U['무한점멸']!, ['bot', 'mid']],
      [U['칼바람러']!, ['top']],
      [MOCK_OTHER_MEMBER_ID, ['jungle', 'mid']],
      [U['서폿요정']!, ['support', 'bot']],
    ],
  );
  add({ game: 'tft', title: '롤체 8인 친선 로비', scheduled_at: h(4.5), capacity: 8, host_id: U['체스왕']! }, [
    [U['체스왕']!, []],
    [U['용용이']!, []],
    [U['와드지기']!, []],
    [U['별빛미드']!, []],
    [U['바론스틸']!, []],
  ]);
  add(
    { game: 'lol', title: '주말 협곡 2판 연속', scheduled_at: h(50), capacity: 10, host_id: me.id, rules: '2판 연속 진행, 2판째는 진영 교체.' },
    [
      [me.id, ['top', 'jungle']],
      [MOCK_OTHER_MEMBER_ID, ['jungle', 'mid']],
      [U['미드고정']!, ['mid', 'top']],
      [U['원딜장인']!, ['bot', 'support']],
      [U['서폿요정']!, ['support', 'bot']],
      [U['한타각']!, ['top', 'jungle']],
      [U['바론스틸']!, ['jungle', 'top']],
      [U['별빛미드']!, ['mid', 'bot']],
      [U['무한점멸']!, ['bot', 'mid']],
      [U['와드지기']!, ['support', 'jungle']],
    ],
    [
      [U['칼바람러']!, ['mid', 'support']],
      [U['용용이']!, ['bot', 'top']],
    ],
  );
  add(
    { game: 'lol', title: '골드 이하 초보 환영 내전', scheduled_at: h(26), capacity: 10, host_id: U['서폿요정']!, rated: false },
    [
      [U['서폿요정']!, ['support']],
      [me.id, ['mid', 'top']],
      [U['바론스틸']!, ['jungle']],
      [U['와드지기']!, ['support', 'jungle']],
      [U['무한점멸']!, ['bot']],
      [U['칼바람러']!, ['jungle', 'mid']],
    ],
  );
  add({ game: 'steam', title: '배틀그라운드 스쿼드 2팀', scheduled_at: h(74), capacity: 8, host_id: U['바론스틸']!, rated: false }, [
    [U['바론스틸']!, []],
    [U['한타각']!, []],
    [U['용용이']!, []],
    [U['원딜장인']!, []],
    [U['체스왕']!, []],
  ]);
  add({ game: 'tft', title: '롤체 더블업 4팀', scheduled_at: h(98), capacity: 8, host_id: U['별빛미드']! }, [
    [U['별빛미드']!, []],
    [U['체스왕']!, []],
    [U['칼바람러']!, []],
    [U['용용이']!, []],
  ]);
  for (let i = 0; i < 7; i += 1) {
    const host = MOCK_SCRIM_USERS[(i * 5) % MOCK_SCRIM_USERS.length]!;
    add(
      { game: i % 2 ? 'tft' : 'steam', title: i % 2 ? `롤체 연습 로비 ${i + 1}` : `스팀 파티 ${i + 1}`, scheduled_at: h(120 + i * 24), capacity: 6, host_id: host.id },
      [[host.id, []]],
    );
  }
  // 시작 시각이 지났지만 아직 시작·자동 마감 전(join_closed)
  add({ game: 'lol', title: '퇴근 후 칼바람 대신 협곡', scheduled_at: iso(now - 10 * MIN_MS), capacity: 10, host_id: U['한타각']! }, [
    [U['한타각']!, ['top']],
    [U['정글차이'] ?? MOCK_OTHER_MEMBER_ID, ['jungle']],
    [U['미드고정']!, ['mid']],
    [U['무한점멸']!, ['bot']],
    [U['와드지기']!, ['support']],
    [U['바론스틸']!, ['jungle', 'top']],
    [U['별빛미드']!, ['mid', 'bot']],
  ]);
  // 진행 중(내가 참가) — 운영진이면 노쇼 표시 가능
  const playing = add(
    { game: 'lol', title: '오늘 밤 협곡 내전', scheduled_at: iso(now - 40 * MIN_MS), capacity: 10, host_id: U['미드고정']!, status: 'playing', started_at: iso(now - 35 * MIN_MS) },
    [
      [U['미드고정']!, ['mid']],
      [me.id, ['top', 'jungle']],
      [MOCK_OTHER_MEMBER_ID, ['jungle']],
      [U['원딜장인']!, ['bot']],
      [U['서폿요정']!, ['support']],
      [U['한타각']!, ['top']],
      [U['바론스틸']!, ['jungle']],
      [U['별빛미드']!, ['mid']],
      [U['무한점멸']!, ['bot']],
      [U['와드지기']!, ['support']],
    ],
  );
  playing.status = 'playing';
  add(
    { game: 'tft', title: '지난주 롤체 로비', scheduled_at: iso(now - 3 * DAY_MS), capacity: 8, host_id: U['체스왕']!, status: 'finished', started_at: iso(now - 3 * DAY_MS) },
    [
      [U['체스왕']!, []],
      [me.id, []],
      [U['용용이']!, []],
      [U['칼바람러']!, []],
    ],
  ).status = 'finished';
  add(
    { game: 'steam', title: '주말 스팀 파티', scheduled_at: iso(now - DAY_MS), capacity: 8, host_id: U['바론스틸']!, status: 'cancelled', cancelled_at: iso(now - DAY_MS + 60 * MIN_MS), cancel_reason: 'not_started' },
    [[U['바론스틸']!, []]],
  ).status = 'cancelled';

  // 노쇼 제한 흉내: 최근 30일 안에 노쇼 3회. 마지막 표시는 6시간 전이라 1일 제한이 아직 남아 있다.
  if (me.nickname.toLowerCase().startsWith('noshow')) {
    for (const hoursAgo of [20 * 24, 9 * 24, 6]) {
      const s = add(
        { game: 'tft', title: `노쇼 기록용 로비 (${hoursAgo}시간 전)`, scheduled_at: iso(now - hoursAgo * 3_600_000), capacity: 8, host_id: U['체스왕']!, status: 'finished', started_at: iso(now - hoursAgo * 3_600_000) },
        [
          [U['체스왕']!, []],
          [me.id, []],
        ],
      );
      s.status = 'finished';
      const row = state.players.find((p) => p.scrim_id === s.id && p.user_id === me.id)!;
      row.status = 'no_show';
      row.no_show_marked_at = iso(now - hoursAgo * 3_600_000);
      row.no_show_marked_by = U['미드고정']!;
    }
  }
  return state;
}

// -----------------------------------------------------------------------------
// 직렬화
// -----------------------------------------------------------------------------

function userRef(id: string, me: Me): ScrimUserRef {
  if (id === me.id) return { id: me.id, nickname: me.nickname, avatar_url: me.avatar_url };
  return MOCK_SCRIM_USERS.find((u) => u.id === id) ?? { id, nickname: '알 수 없음', avatar_url: null };
}

/** 목록 커서 = base64url(JSON {t, s, id}) — 서버와 같은 모양(내용은 웹이 해석하지 않는다) */
function encodeCursor(c: { t: string; s: string; id: string }): string {
  return btoa(JSON.stringify(c)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeCursor(raw: string): { t: string; s: string; id: string } | null {
  try {
    const b = raw.replace(/-/g, '+').replace(/_/g, '/');
    const v = JSON.parse(atob(b + '='.repeat((4 - (b.length % 4)) % 4))) as unknown;
    const p = z.object({ t: z.string(), s: z.string(), id: z.string() }).safeParse(v);
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// 라우터
// -----------------------------------------------------------------------------

function matchTemplate(template: string, path: string): Record<string, string> | null {
  const names: string[] = [];
  const re = new RegExp(
    `^${template.replace(/:([A-Za-z_]+)/g, (_, name: string) => {
      names.push(name);
      return '([^/]+)';
    })}$`,
  );
  const m = re.exec(path);
  if (!m) return null;
  return Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(m[i + 1] ?? '')]));
}

const issues = (e: z.ZodError) => e.issues.map((i) => ({ path: i.path.join('.') || 'body', message: i.message }));

/** S2 경로가 아니면 null */
export function handleS2(ctx: MockS2Context): Response | null {
  const { method, path, me, now, json, error } = ctx;
  const isS2 =
    path === ApiPath.games ||
    path === ApiPath.steamApps ||
    path === ApiPath.myScrimRestriction ||
    path === ApiPath.scrims ||
    path.startsWith('/scrims/');
  if (!isS2) return null;

  let state = ctx.state;
  if (state.owner !== me.id) {
    state = seed(me, now);
    ctx.save(state);
  }
  const policy = ctx.opts?.noShowPolicy ?? {
    threshold: NO_SHOW_THRESHOLD_DEFAULT,
    windowDays: NO_SHOW_WINDOW_DAYS_DEFAULT,
    restrictionDays: NO_SHOW_RESTRICTION_DAYS_DEFAULT,
  };
  const isAdmin = me.role === 'admin';
  const persist = () => ctx.save(state);

  const rowsOf = (scrimId: string) => state.players.filter((p) => p.scrim_id === scrimId);
  const joinedRows = (scrimId: string) => rowsOf(scrimId).filter((p) => p.status === 'joined');
  const waitRows = (scrimId: string) => orderWaitlist(rowsOf(scrimId).filter((p) => p.status === 'waitlist'));
  const canStart = (s: MockScrim) => {
    const g = gameOf(s.game);
    const joined = joinedRows(s.id).length;
    return g.start_requires_full ? joined === s.capacity : joined >= SCRIM_MIN_PLAYERS_TO_START;
  };
  const restrictionOf = (userId: string) =>
    computeRestriction(
      state.players
        .filter((p) => p.user_id === userId && p.status === 'no_show' && p.no_show_marked_at)
        .map((p) => Date.parse(p.no_show_marked_at!)),
      now,
      policy,
    );

  // 자동 마감(5-5): 요청마다 밀린 것 처리
  let changed = false;
  for (const s of state.scrims) {
    if (!isOpen(s) || now < Date.parse(s.scheduled_at) + SCRIM_AUTO_CLOSE_AFTER_MIN_DEFAULT * MIN_MS) continue;
    if (canStart(s)) Object.assign(s, { status: 'playing', started_at: iso(now), updated_at: iso(now) });
    else Object.assign(s, { status: 'cancelled', cancelled_at: iso(now), cancel_reason: 'not_started', updated_at: iso(now) });
    changed = true;
  }
  if (changed) persist();

  /** 서버 흐름 4단계 뒤: 대기열 승격 + recruiting ↔ full */
  const settleRoster = (s: MockScrim) => {
    let joined = joinedRows(s.id).length;
    for (const w of waitRows(s.id)) {
      if (joined >= s.capacity) break;
      w.status = 'joined'; // preferred_positions·joined_at 그대로(메인 기본값 7)
      joined += 1;
    }
    if (isOpen(s)) s.status = joined >= s.capacity ? 'full' : 'recruiting';
  };

  const summary = (s: MockScrim): ScrimSummary => {
    const rows = rowsOf(s.id);
    const joined = rows.filter((p) => p.status === 'joined');
    const noShow = rows.filter((p) => p.status === 'no_show').length;
    const mine = rows.find((p) => p.user_id === me.id && p.status !== 'cancelled');
    const g = gameOf(s.game);
    return ScrimSummary.parse({
      id: s.id,
      game: { code: g.code, name: g.name, has_positions: g.has_positions, has_teams: g.has_teams, positions: [...g.positions] },
      title: s.title,
      scheduled_at: s.scheduled_at,
      capacity: s.capacity,
      status: s.status,
      host: userRef(s.host_id, me),
      joined_count: isOpen(s) ? joined.length : joined.length + noShow,
      waitlist_count: rows.filter((p) => p.status === 'waitlist').length,
      options: { rated: s.rated, auto_balance: s.auto_balance, use_positions: s.use_positions },
      steam_app: s.steam_app,
      open_positions:
        isOpen(s) && s.use_positions
          ? computeOpenPositions(g.positions, s.capacity, joined.map((p) => p.preferred_positions[0] ?? null))
          : [],
      join_closed: isClosed(s, now),
      my_status: mine?.status ?? null,
      created_at: s.created_at,
    });
  };

  const detail = (s: MockScrim): ScrimDetail => {
    const rows = rowsOf(s.id);
    const players = rows
      .filter((p) => p.status === 'joined' || p.status === 'no_show')
      .sort((a, b) => {
        const ha = a.user_id === s.host_id ? 0 : 1;
        const hb = b.user_id === s.host_id ? 0 : 1;
        return ha - hb || Date.parse(a.joined_at) - Date.parse(b.joined_at) || (a.user_id < b.user_id ? -1 : 1);
      });
    const waitlist = waitRows(s.id);
    const mine = rows.find((p) => p.user_id === me.id && p.status !== 'cancelled');
    const r = restrictionOf(me.id);
    const open = isOpen(s);
    const closed = isClosed(s, now);
    const isHost = s.host_id === me.id;
    const inRoster = mine?.status === 'joined' || mine?.status === 'waitlist';
    return ScrimDetail.parse({
      ...summary(s),
      rules: s.rules,
      started_at: s.started_at,
      cancelled_at: s.cancelled_at,
      cancel_reason: s.cancel_reason,
      updated_at: s.updated_at,
      players: players.map((p) => ({
        user: userRef(p.user_id, me),
        status: p.status,
        is_host: p.user_id === s.host_id,
        preferred_positions: p.preferred_positions,
        joined_at: p.joined_at,
        position: null,
        team: null,
        no_show_marked_at: p.status === 'no_show' ? p.no_show_marked_at : null,
      })),
      waitlist: waitlist.map((p, i) => ({
        order: i + 1,
        user: userRef(p.user_id, me),
        preferred_positions: p.preferred_positions,
        joined_at: p.joined_at,
      })),
      viewer: {
        status: mine?.status ?? null,
        waitlist_order: mine?.status === 'waitlist' ? waitlist.findIndex((w) => w.id === mine.id) + 1 : null,
        preferred_positions: inRoster ? mine.preferred_positions : [],
        is_host: isHost,
        restricted_until: r.until !== null ? iso(r.until) : null,
        can_join: open && !closed && !inRoster && !r.restricted,
        can_leave: open && !closed && inRoster && !isHost,
        can_edit: isHost && open,
        can_cancel: (isHost || isAdmin) && open,
        can_start: (isHost || isAdmin) && open && canStart(s),
        can_mark_no_show:
          isAdmin &&
          (s.status === 'playing' || s.status === 'finished') &&
          now <= Date.parse(s.scheduled_at) + NO_SHOW_MARK_WINDOW_DAYS_DEFAULT * DAY_MS,
      },
      balance: null,
      result: null,
    });
  };

  const banned = (r: ReturnType<typeof restrictionOf>) =>
    error('SCRIM_BANNED', '노쇼 누적으로 참가·작성이 제한되었습니다.', {
      retryAfterSec: Math.ceil(((r.until ?? now) - now) / 1000),
    });
  const invalidId = (name: string, v: string) =>
    Uuid.safeParse(v).success ? null : error('VALIDATION_FAILED', `${name} 형식이 올바르지 않습니다.`, { details: [{ path: name, message: 'uuid' }] });
  const scheduleIssue = (at: string): string | null => {
    const t = Date.parse(at);
    if (t <= now) return '시작 시각은 지금보다 뒤여야 해요';
    if (t > now + SCRIM_SCHEDULE_MAX_DAYS_AHEAD_DEFAULT * DAY_MS) return `시작 시각은 ${SCRIM_SCHEDULE_MAX_DAYS_AHEAD_DEFAULT}일 안이어야 해요`;
    return null;
  };
  const notInStore = { path: 'steam_app_id', message: '스팀 상점에서 찾을 수 없는 게임입니다.' };
  const capacityIssue = (game: GameSeed, cap: number): string | null =>
    cap < game.capacity_min || cap > game.capacity_max || (cap - game.capacity_min) % game.capacity_step !== 0
      ? `정원은 ${game.capacity_min}–${game.capacity_max}명${game.capacity_step > 1 ? ` ${game.capacity_step}명 단위` : ''}이에요`
      : null;

  // GET /games
  if (path === ApiPath.games && method === 'GET') {
    const res: ListGamesResponse = { items: mockGames(), next_cursor: null };
    return json(200, res);
  }

  // GET /steam-apps?q=
  if (path === ApiPath.steamApps && method === 'GET') {
    const parsed = SearchSteamAppsQuery.safeParse(Object.fromEntries(ctx.search.entries()));
    if (!parsed.success) return error('VALIDATION_FAILED', '검색어가 올바르지 않습니다.', { details: issues(parsed.error) });
    const q = parsed.data.q.toLowerCase();
    const owned = MOCK_STEAM_APPS.filter((a) => a.owner_count > 0);
    let res: SearchSteamAppsResponse;
    if (q === '') res = { items: owned.slice(0, STEAM_APP_SEARCH_LIMIT), store_unavailable: false };
    else {
      const storeDown = q.includes('상점오류');
      const hit = (a: SteamAppOption) => a.name.toLowerCase().includes(q);
      const mine = owned.filter(hit).slice(0, 10);
      const store = storeDown ? [] : MOCK_STEAM_APPS.filter((a) => hit(a) && !mine.includes(a));
      res = { items: [...mine, ...store].slice(0, STEAM_APP_SEARCH_LIMIT), store_unavailable: storeDown };
    }
    return json(200, res);
  }

  // GET /me/scrim-restriction
  if (path === ApiPath.myScrimRestriction && method === 'GET') {
    const r = restrictionOf(me.id);
    return json(
      200,
      ScrimRestriction.parse({
        restricted: r.restricted,
        until: r.until !== null ? iso(r.until) : null,
        recent_no_show_count: r.recentCount,
        last_no_show_at: r.last !== null ? iso(r.last) : null,
        policy: { threshold: policy.threshold, window_days: policy.windowDays, restriction_days: policy.restrictionDays },
      }),
    );
  }

  // GET /scrims
  if (path === ApiPath.scrims && method === 'GET') {
    const parsed = ListScrimsQuery.safeParse(Object.fromEntries(ctx.search.entries()));
    if (!parsed.success) return error('VALIDATION_FAILED', '쿼리가 올바르지 않습니다.', { details: issues(parsed.error) });
    const q = parsed.data;
    const statuses = { open: ['recruiting', 'full'], playing: ['playing'], ended: ['finished', 'cancelled'] }[q.status];
    const asc = q.status === 'open';
    const cmp = (a: MockScrim, b: MockScrim) => {
      const d = Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      return asc ? d : -d;
    };
    let list = state.scrims.filter((s) => statuses.includes(s.status) && (!q.game || s.game === q.game)).sort(cmp);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      if (!c || c.t !== q.status) {
        return error('VALIDATION_FAILED', '커서가 올바르지 않습니다.', { details: [{ path: 'cursor', message: 'invalid cursor' }] });
      }
      const key = { scheduled_at: c.s, id: c.id } as MockScrim;
      list = list.filter((s) => cmp(s, key) > 0);
    }
    const page = list.slice(0, q.limit);
    const last = page[page.length - 1];
    const res: ListScrimsResponse = {
      items: page.map(summary),
      next_cursor: list.length > q.limit && last ? encodeCursor({ t: q.status, s: last.scheduled_at, id: last.id }) : null,
    };
    return json(200, res);
  }

  // POST /scrims
  if (path === ApiPath.scrims && method === 'POST') {
    const parsed = CreateScrimRequest.safeParse(ctx.body);
    if (!parsed.success) return error('VALIDATION_FAILED', '요청 형식이 올바르지 않습니다.', { details: issues(parsed.error) });
    const b = parsed.data;
    const game = gameOf(b.game);
    const usePositions = b.use_positions && game.has_positions;
    const details: { path: string; message: string }[] = [];
    const si = scheduleIssue(b.scheduled_at);
    if (si) details.push({ path: 'scheduled_at', message: si });
    const ci = capacityIssue(game, b.capacity);
    if (ci) details.push({ path: 'capacity', message: ci });
    const pi = validatePositions(b.host_preferred_positions, game.positions, usePositions);
    if (pi) details.push({ path: 'host_preferred_positions', message: pi });
    const appId = b.steam_app_id ?? null;
    if (game.requires_steam_app && appId === null) details.push({ path: 'steam_app_id', message: '스팀 게임을 골라 주세요.' });
    if (!game.requires_steam_app && appId !== null) details.push({ path: 'steam_app_id', message: '이 게임은 스팀 게임을 고를 수 없습니다.' });
    if (details.length) return error('VALIDATION_FAILED', '입력값을 확인해 주세요.', { details });
    const r = restrictionOf(me.id);
    if (r.restricted) return banned(r);
    const app = appId === null ? null : steamApp(appId);
    if (appId !== null && !app) return error('VALIDATION_FAILED', '입력값을 확인해 주세요.', { details: [notInStore] });
    const s: MockScrim = {
      id: crypto.randomUUID(),
      game: b.game,
      title: b.title,
      scheduled_at: iso(Date.parse(b.scheduled_at)),
      capacity: b.capacity,
      status: 'recruiting',
      host_id: me.id,
      rules: b.rules ?? null,
      rated: b.rated,
      auto_balance: b.auto_balance && game.has_teams,
      use_positions: usePositions,
      steam_app: app,
      started_at: null,
      cancelled_at: null,
      cancel_reason: null,
      created_at: iso(now),
      updated_at: iso(now),
    };
    state.scrims.push(s);
    state.players.push({
      id: crypto.randomUUID(),
      scrim_id: s.id,
      user_id: me.id,
      status: 'joined',
      preferred_positions: usePositions ? b.host_preferred_positions : [],
      joined_at: iso(now),
      no_show_marked_at: null,
      no_show_marked_by: null,
    });
    persist();
    return json(201, detail(s));
  }

  // PUT /scrims/:id/players/:userId/no-show — 역할 검사가 먼저(@Roles('admin'))
  let m = matchTemplate(ApiPath.scrimPlayerNoShow, path);
  if (m && method === 'PUT') {
    if (!isAdmin) return error('FORBIDDEN', '운영진만 노쇼를 표시할 수 있습니다.');
    const bad = invalidId('id', m.id!) ?? invalidId('userId', m.userId!);
    if (bad) return bad;
    const parsed = SetScrimNoShowRequest.safeParse(ctx.body);
    if (!parsed.success) return error('VALIDATION_FAILED', '요청 형식이 올바르지 않습니다.', { details: issues(parsed.error) });
    const s = state.scrims.find((x) => x.id === m!.id);
    if (!s) return error('NOT_FOUND', '내전 없음');
    if (s.status !== 'playing' && s.status !== 'finished') return error('SCRIM_NO_SHOW_NOT_ALLOWED', '시작 전');
    const row = rowsOf(s.id).find((p) => p.user_id === m!.userId);
    if (!row) return error('NOT_FOUND', '참가 기록 없음');
    if (row.status !== 'joined' && row.status !== 'no_show') return error('SCRIM_NO_SHOW_NOT_ALLOWED', '대상 아님');
    if (parsed.data.no_show && row.status === 'joined') {
      if (now > Date.parse(s.scheduled_at) + NO_SHOW_MARK_WINDOW_DAYS_DEFAULT * DAY_MS) {
        return error('SCRIM_NO_SHOW_NOT_ALLOWED', '표시 기한 경과');
      }
      Object.assign(row, { status: 'no_show', no_show_marked_at: iso(now), no_show_marked_by: me.id });
      s.updated_at = iso(now);
      persist();
    } else if (!parsed.data.no_show && row.status === 'no_show') {
      Object.assign(row, { status: 'joined', no_show_marked_at: null, no_show_marked_by: null });
      s.updated_at = iso(now);
      persist();
    }
    return json(200, detail(s));
  }

  // /scrims/:id/join | start | cancel
  for (const [template, action] of [
    [ApiPath.scrimJoin, 'join'],
    [ApiPath.scrimStart, 'start'],
    [ApiPath.scrimCancel, 'cancel'],
  ] as const) {
    m = matchTemplate(template, path);
    if (!m) continue;
    const bad = invalidId('id', m.id!);
    if (bad) return bad;
    const s = state.scrims.find((x) => x.id === m!.id);
    if (!s) return error('NOT_FOUND', '내전 없음');
    const isHost = s.host_id === me.id;
    const game = gameOf(s.game);

    if (action === 'join' && method === 'POST') {
      // 본문 필수(서버와 같게): 포지션 없는 게임도 {}를 보낸다. 본문이 없으면 VALIDATION_FAILED
      const parsed = JoinScrimRequest.safeParse(ctx.body);
      if (!parsed.success) return error('VALIDATION_FAILED', '요청 형식이 올바르지 않습니다.', { details: issues(parsed.error) });
      if (!isOpen(s)) return error('SCRIM_NOT_RECRUITING', '모집 중 아님');
      if (isClosed(s, now)) return error('SCRIM_JOIN_CLOSED', '시작 시각 지남');
      const pi = validatePositions(parsed.data.preferred_positions, game.positions, s.use_positions);
      if (pi) return error('VALIDATION_FAILED', '희망 포지션을 확인해 주세요.', { details: [{ path: 'preferred_positions', message: pi }] });
      const mine = rowsOf(s.id).find((p) => p.user_id === me.id);
      if (mine && (mine.status === 'joined' || mine.status === 'waitlist')) {
        mine.preferred_positions = parsed.data.preferred_positions;
        s.updated_at = iso(now);
        persist();
        return json(200, detail(s));
      }
      const r = restrictionOf(me.id);
      if (r.restricted) return banned(r);
      const placed = joinedRows(s.id).length < s.capacity ? 'joined' : 'waitlist';
      if (mine) Object.assign(mine, { status: placed, preferred_positions: parsed.data.preferred_positions, joined_at: iso(now) });
      else {
        state.players.push({
          id: crypto.randomUUID(),
          scrim_id: s.id,
          user_id: me.id,
          status: placed,
          preferred_positions: parsed.data.preferred_positions,
          joined_at: iso(now),
          no_show_marked_at: null,
          no_show_marked_by: null,
        });
      }
      settleRoster(s);
      s.updated_at = iso(now);
      persist();
      return json(200, detail(s));
    }

    if (action === 'join' && method === 'DELETE') {
      if (!isOpen(s)) return error('SCRIM_NOT_RECRUITING', '모집 중 아님');
      if (isClosed(s, now)) return error('SCRIM_JOIN_CLOSED', '시작 시각 지남');
      if (isHost) return error('SCRIM_HOST_CANNOT_LEAVE', '방장은 취소 불가');
      const mine = rowsOf(s.id).find((p) => p.user_id === me.id);
      if (mine && (mine.status === 'joined' || mine.status === 'waitlist')) {
        mine.status = 'cancelled';
        settleRoster(s);
        s.updated_at = iso(now);
        persist();
      }
      return json(200, detail(s));
    }

    if (action === 'start' && method === 'POST') {
      if (!isHost && !isAdmin) return error('FORBIDDEN', '방장·운영진만');
      if (!isOpen(s)) return error('SCRIM_NOT_RECRUITING', '모집 중 아님');
      if (!canStart(s)) return error('SCRIM_CANNOT_START', '시작 조건 미충족');
      Object.assign(s, { status: 'playing', started_at: iso(now), updated_at: iso(now) });
      persist();
      return json(200, detail(s));
    }

    if (action === 'cancel' && method === 'POST') {
      if (!isHost && !isAdmin) return error('FORBIDDEN', '방장·운영진만');
      if (!isOpen(s)) return error('SCRIM_NOT_RECRUITING', '모집 중 아님');
      Object.assign(s, { status: 'cancelled', cancelled_at: iso(now), cancel_reason: isHost ? 'host' : 'admin', updated_at: iso(now) });
      persist();
      return json(200, detail(s));
    }
  }

  // GET·PATCH /scrims/:id
  m = matchTemplate(ApiPath.scrim, path);
  if (m && (method === 'GET' || method === 'PATCH')) {
    const bad = invalidId('id', m.id!);
    if (bad) return bad;
    const s = state.scrims.find((x) => x.id === m!.id);
    if (!s) return error('NOT_FOUND', '내전 없음');
    if (method === 'GET') return json(200, detail(s));

    const parsed = UpdateScrimRequest.safeParse(ctx.body);
    if (!parsed.success) return error('VALIDATION_FAILED', '요청 형식이 올바르지 않습니다.', { details: issues(parsed.error) });
    if (s.host_id !== me.id) return error('FORBIDDEN', '방장만 수정');
    if (!isOpen(s)) return error('SCRIM_NOT_RECRUITING', '모집 중 아님');
    const b = parsed.data;
    const game = gameOf(s.game);
    const details: { path: string; message: string }[] = [];
    if (b.scheduled_at !== undefined) {
      const si = scheduleIssue(b.scheduled_at);
      if (si) details.push({ path: 'scheduled_at', message: si });
    }
    if (b.capacity !== undefined) {
      const ci = capacityIssue(game, b.capacity);
      if (ci) details.push({ path: 'capacity', message: ci });
    }
    const app = b.steam_app_id === undefined ? undefined : steamApp(b.steam_app_id);
    if (b.steam_app_id !== undefined && !game.requires_steam_app) {
      details.push({ path: 'steam_app_id', message: '이 게임은 스팀 게임을 고를 수 없습니다.' });
    } else if (app === null) details.push(notInStore);
    if (details.length) return error('VALIDATION_FAILED', '입력값을 확인해 주세요.', { details });
    if (b.capacity !== undefined && b.capacity < joinedRows(s.id).length) {
      return error('SCRIM_CAPACITY_BELOW_JOINED', '정원 < 참가 인원');
    }
    if (b.title !== undefined) s.title = b.title;
    if (b.scheduled_at !== undefined) s.scheduled_at = iso(Date.parse(b.scheduled_at));
    if (b.rules !== undefined) s.rules = b.rules ?? null;
    if (b.rated !== undefined) s.rated = b.rated;
    if (b.auto_balance !== undefined) s.auto_balance = b.auto_balance && game.has_teams;
    if (app) s.steam_app = app;
    if (b.capacity !== undefined) {
      s.capacity = b.capacity;
      settleRoster(s);
    }
    s.updated_at = iso(now);
    persist();
    return json(200, detail(s));
  }

  return null;
}
