import {
  activityPeriodWindow,
  buildActivityRanking,
  buildPlaytimeRanking,
  computeRankChange,
  kstDateKey,
  kstDayWindow,
  kstWeekWindow,
  nowPlayingItems,
  pickMainGames,
  presenceState,
} from '@gcd/core';
import {
  ACTIVITY_COUNTED_TYPES,
  ACTIVITY_RANKED_TYPES,
  GAME_SEED,
  GetActivityRankingResponse,
  GetPlaytimeRankingResponse,
  RANKING_ITEMS_MAX,
  type ActivityPeriod,
  type ActivityType,
  type BotPresencePlaying,
  type DashboardCommunity,
  type GameCode,
  type Me,
  type ScrimUserRef,
  type SteamAppOption,
} from '@gcd/shared';
import { z } from 'zod';

/**
 * [목] S5 활동·플레이타임 랭킹, 홈 community(계약 S5 4-1·7·8·10절).
 * 순위·기간·접속 현황 판정은 @gcd/core를 import한다(공식 복사본 없음). 활동 기록·스팀 플레이타임은 시드 없이
 * 멤버 id와 날짜로 정해지는 값을 그때그때 만든다(새로고침해도 같은 값, 날짜가 바뀌면 함께 움직인다).
 *
 * 봇 상태: localStorage `gcd-mock-bot` (새로고침하면 적용, 기본 live)
 *   none          봇 미연결: 활동 기록·접속 현황 없음 → 랭킹 bot_connected false, 홈 음성·활동 멤버 카드 숨김
 *   live          접속 현황 40초 전(live) + 지금 플레이 중
 *   stale         접속 현황 20분 전(stale) → 음성 「—」 + 「마지막 HH:mm」, 지금 플레이 중 없음
 *   no_playing    live인데 playing 0행 → 지금 플레이 중 없음
 *   empty_period  이번 주·이번 달 활동 없음(그 전 기록은 있음) → 「이번 주 활동 기록이 아직 없어요」, 활동 멤버 0명
 *
 * 활동 순위 시간·주 게임은 음성(ACTIVITY_RANKED_TYPES)만 쓴다(D232). 활동 일수·홈 「이번 주 활동 멤버」는
 * voice·chat(ACTIVITY_COUNTED_TYPES)만 센다. play 이벤트는 만들어 두지만(봇은 계속 보낸다) 어떤 집계에도 쓰지 않는다(D240). 참고 열 scrim_count는 목 내전 자료로 센다(D239, mockScrimJoins).
 *
 * 디스코드 연동은 목 GET /me의 discord_id로만 보인다(D238): 디스코드 로그인 → 연동됨, 개발 로그인 `dev-…` → 미연동.
 */

export const MOCK_BOT_SCENARIO_KEY = 'gcd-mock-bot';
export const MockBotScenario = z.enum(['none', 'live', 'stale', 'no_playing', 'empty_period']);
export type MockBotScenario = z.infer<typeof MockBotScenario>;

const DAY_MS = 86_400_000;
const MIN = 60;
const HOUR = 3600;
/** 생성하는 활동 기록 범위(지난달 기준 순위가 나오게 두 달 남짓) */
const ACTIVITY_HISTORY_DAYS = 70;

// -----------------------------------------------------------------------------
// 결정적 난수
// -----------------------------------------------------------------------------

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** [0, 1) */
const rand = (...parts: (string | number)[]) => hash(parts.join('|')) / 4294967296;

// -----------------------------------------------------------------------------
// 활동 기록(activity_logs 흉내)
// -----------------------------------------------------------------------------

export interface MockActivityLog {
  userId: string;
  type: ActivityType;
  game: GameCode | null;
  startedAt: number;
  durationSec: number;
}

/**
 * 멤버별 성향: 활동 빈도, 주 게임 비중. 마지막 멤버는 채팅만(시간 0 → 순위 없음, 활동 멤버에는 포함).
 * 끝에서 두 번째 멤버는 게임 없이 음성만(주 게임 없음 → 표 「—」, 모바일 보조 줄 생략 확인용)
 */
function persona(i: number, count: number) {
  const chatOnly = i === count - 1;
  const freq = 0.3 + ((i * 37) % 60) / 100;
  const games: GameCode[] =
    i === count - 2 ? [] : i % 4 === 0 ? ['tft', 'lol'] : i % 4 === 1 ? ['lol', 'steam'] : i % 4 === 2 ? ['lol'] : ['steam', 'tft'];
  return { chatOnly, freq, games };
}

/** 끝난 세션만 만든다(봇 계약: 진행 중 세션은 보내지 않는다). 20:00 KST 전후 시작 */
export function mockActivityLogs(userIds: readonly string[], now: number): MockActivityLog[] {
  const out: MockActivityLog[] = [];
  const today = kstDayWindow(new Date(now)).start.getTime();
  userIds.forEach((userId, i) => {
    const p = persona(i, userIds.length);
    for (let d = ACTIVITY_HISTORY_DAYS; d >= 0; d--) {
      const day = today - d * DAY_MS;
      const r = rand(userId, day);
      if (r > p.freq) continue;
      // 하루 1건 채팅(문서 6장 권장)
      out.push({ userId, type: 'chat', game: null, startedAt: day + 12 * HOUR * 1000, durationSec: 0 });
      if (p.chatOnly) continue;
      const voiceStart = day + (19 + Math.floor(rand(userId, day, 's') * 4)) * HOUR * 1000 + Math.floor(rand(userId, day, 'm') * 60) * MIN * 1000;
      const voiceSec = (20 + Math.floor(rand(userId, day, 'v') * 220)) * MIN;
      const g = p.games[Math.floor(rand(userId, day, 'g') * p.games.length)] ?? null;
      out.push({ userId, type: 'voice', game: g, startedAt: voiceStart, durationSec: voiceSec });
      if (rand(userId, day, 'p') < 0.35) {
        out.push({ userId, type: 'play', game: 'steam', startedAt: voiceStart + voiceSec * 1000, durationSec: (30 + Math.floor(rand(userId, day, 'q') * 120)) * MIN });
      }
    }
  });
  return out.filter((l) => l.startedAt + l.durationSec * 1000 <= now);
}

/** 시나리오 적용. none → 기록 없음, empty_period → 이번 주·이번 달 시작 전 기록만 */
export function scenarioLogs(logs: readonly MockActivityLog[], bot: MockBotScenario, now: number): MockActivityLog[] {
  if (bot === 'none') return [];
  if (bot === 'empty_period') {
    const nowDate = new Date(now);
    const cut = Math.min(activityPeriodWindow('week', nowDate).start.getTime(), activityPeriodWindow('month', nowDate).start.getTime());
    return logs.filter((l) => l.startedAt < cut);
  }
  return [...logs];
}

const GAME_ORDER = new Map(GAME_SEED.map((g) => [g.code, g]));

const RANKED = new Set<ActivityType>(ACTIVITY_RANKED_TYPES);
const COUNTED = new Set<ActivityType>(ACTIVITY_COUNTED_TYPES);

/** 기간 [start, end) 집계 → core 순위. 시간·주 게임 = 음성만(D232), 활동 일수 = voice·chat(D240, play 제외) */
function rankActivity(logs: readonly MockActivityLog[], start: number, end: number) {
  const byUser = new Map<string, { userId: string; voiceSec: number; days: Set<string>; games: Map<GameCode, number> }>();
  for (const l of logs) {
    if (l.startedAt < start || l.startedAt >= end) continue;
    if (!COUNTED.has(l.type)) continue;
    const u = byUser.get(l.userId) ?? { userId: l.userId, voiceSec: 0, days: new Set(), games: new Map() };
    u.days.add(kstDateKey(new Date(l.startedAt)));
    if (RANKED.has(l.type)) {
      u.voiceSec += l.durationSec;
      if (l.game) u.games.set(l.game, (u.games.get(l.game) ?? 0) + l.durationSec);
    }
    byUser.set(l.userId, u);
  }
  return buildActivityRanking([...byUser.values()].map((u) => ({ ...u, activeDays: u.days.size })));
}

// -----------------------------------------------------------------------------
// 내전 참여 수(scrim_count 참고 열, 계약 7-1 r2, D239)
// -----------------------------------------------------------------------------

/** 목 내전 자료에서 필요한 모양만(scrims.ts MockS2State가 그대로 맞는다) */
export interface MockScrimSource {
  scrims: readonly { id: string; status: string; scheduled_at: string; started_at: string | null }[];
  players: readonly { scrim_id: string; user_id: string; status: string }[];
  results: readonly { scrim_id: string; status: string }[];
}

/** 참가 1건 = (회원, 내전 시작 시각). 셈 규칙: 취소 아닌 내전 + 승인 결과 1건 이상 + joined 참가 행. 시각 = COALESCE(started_at, scheduled_at) */
export interface MockScrimJoin {
  userId: string;
  scrimId: string;
  startAt: number;
}

export function mockScrimJoins(src: MockScrimSource): MockScrimJoin[] {
  const approved = new Set(src.results.filter((r) => r.status === 'approved').map((r) => r.scrim_id));
  const start = new Map(src.scrims.filter((s) => s.status !== 'cancelled' && approved.has(s.id)).map((s) => [s.id, Date.parse(s.started_at ?? s.scheduled_at)]));
  const out: MockScrimJoin[] = [];
  const seen = new Set<string>();
  for (const p of src.players) {
    const at = start.get(p.scrim_id);
    if (at === undefined || p.status !== 'joined') continue;
    const key = `${p.user_id}|${p.scrim_id}`; // COUNT(DISTINCT s.id)
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ userId: p.user_id, scrimId: p.scrim_id, startAt: at });
  }
  return out;
}

function scrimCounts(joins: readonly MockScrimJoin[], start: number, end: number): Map<string, number> {
  const m = new Map<string, number>();
  for (const j of joins) if (j.startAt >= start && j.startAt < end) m.set(j.userId, (m.get(j.userId) ?? 0) + 1);
  return m;
}

export interface MockCacheMeta {
  synced_at: string;
  stale: boolean;
}

export function activityResponse(input: {
  period: ActivityPeriod;
  now: number;
  logs: readonly MockActivityLog[];
  /** 접속 현황 행이 있는가(bot_connected 판정, D228) */
  presence: boolean;
  me: Me;
  userRef: (id: string) => ScrimUserRef;
  cache: MockCacheMeta;
  meOutside: boolean;
  /** 승인된 내전 참가(mockScrimJoins). 순위·정렬에는 쓰지 않는다 */
  scrimJoins: readonly MockScrimJoin[];
}): GetActivityRankingResponse {
  const w = activityPeriodWindow(input.period, new Date(input.now));
  const scrims = scrimCounts(input.scrimJoins, w.start.getTime(), w.end.getTime());
  const prev = activityPeriodWindow(input.period, new Date(w.start.getTime() - 1));
  const prevRanks = new Map(rankActivity(input.logs, prev.start.getTime(), prev.end.getTime()).map((e) => [e.userId, e.rank]));
  const entries = rankActivity(input.logs, w.start.getTime(), w.end.getTime()).map((e) => ({
    rank: e.rank,
    user: input.userRef(e.userId),
    total_sec: e.totalSec,
    voice_sec: e.voiceSec,
    active_days: e.activeDays,
    scrim_count: scrims.get(e.userId) ?? 0,
    main_games: pickMainGames([...e.games].map(([code, sec]) => ({ gameId: code, sortOrder: GAME_ORDER.get(code)?.sort_order ?? 99, sec }))).map((g) => ({
      code: g.gameId as GameCode,
      name: GAME_ORDER.get(g.gameId as GameCode)?.name ?? g.gameId,
    })),
    rank_change: computeRankChange(prevRanks.get(e.userId), e.rank),
  }));
  const me = entries.find((e) => e.user.id === input.me.id) ?? null;
  const shown = input.meOutside ? entries.filter((e) => e.user.id !== input.me.id) : entries;
  return GetActivityRankingResponse.parse({
    items: shown.slice(0, RANKING_ITEMS_MAX),
    next_cursor: null,
    period: input.period,
    period_start: kstIso(w.start.getTime()),
    period_end: kstIso(w.end.getTime()),
    period_days: w.days,
    bot_connected: input.logs.length > 0 || input.presence,
    total: entries.length,
    me,
    ...input.cache,
  });
}

/** `2026-10-26T00:00:00.000+09:00` (서버 응답 표기 흉내) */
function kstIso(t: number): string {
  return `${new Date(t + 9 * HOUR * 1000).toISOString().slice(0, 23)}+09:00`;
}

// -----------------------------------------------------------------------------
// 스팀 플레이타임(steam_playtime 흉내)
// -----------------------------------------------------------------------------

/**
 * 보유자가 없는 게임(「이 게임 플레이 기록이 있는 멤버가 없어요」 확인용). 멤버 하나가 0분으로 갖고 있지만
 * 「보유자」(대표·verified·minutes_total > 0, D234)가 아니라 /steam-apps(q 없음)에 나오지 않는다. 주소 app_id로만 연다.
 */
export const MOCK_PLAYTIME_ZERO_APP = 550;

/**
 * 보유자 = 목록 순서로 회전한 멤버 앞 owner_count명(minutes_total은 항상 60 이상 → 모두 보유자).
 * /steam-apps(q 없음) owner_count와 플레이타임 순위 인원이 같다(D234). 목록 밖 app은 보유자 없음
 */
export function mockPlaytimeOwners(appId: number, apps: readonly SteamAppOption[], userIds: readonly string[]): string[] {
  const appIdx = apps.findIndex((a) => a.app_id === appId);
  const app = apps[appIdx];
  if (!app || app.owner_count < 1) return [];
  return rotate(userIds, appIdx * 3).slice(0, app.owner_count);
}

export function playtimeResponse(input: {
  appId: number;
  apps: readonly SteamAppOption[];
  userIds: readonly string[];
  now: number;
  me: Me;
  userRef: (id: string) => ScrimUserRef;
  cache: MockCacheMeta;
  meOutside: boolean;
}): GetPlaytimeRankingResponse {
  const app = input.apps.find((a) => a.app_id === input.appId);
  const owners = mockPlaytimeOwners(input.appId, input.apps, input.userIds);
  const rows = owners.map((userId) => {
    const minutesTotal = 60 + Math.floor(rand(userId, input.appId, 't') ** 2 * 130_000);
    const minutesRecent = Math.floor(rand(userId, input.appId, 'r') * 1_500);
    return { userId, minutesTotal, minutesRecent };
  });
  // 순위 변동: 2주 전 값(누적 − 최근 2주)으로 매긴 순위 대비(주간 기준 D153 흉내)
  const before = new Map(buildPlaytimeRanking(rows.map((r) => ({ ...r, minutesTotal: Math.max(1, r.minutesTotal - r.minutesRecent), minutesRecent: 0 }))).map((e) => [e.userId, e.rank]));
  const entries = buildPlaytimeRanking(rows).map((e) => {
    const user = input.userRef(e.userId);
    return {
      rank: e.rank,
      user,
      account_name: user.nickname,
      minutes_total: e.minutesTotal,
      minutes_recent: e.minutesRecent,
      rank_change: computeRankChange(before.get(e.userId), e.rank),
    };
  });
  // 하루 1회 05:00 KST 동기화(오늘 05:00 전이면 어제)
  const day = kstDayWindow(new Date(input.now)).start.getTime();
  const five = day + 5 * HOUR * 1000 + 2 * MIN * 1000;
  const syncedAt = five <= input.now ? five : five - DAY_MS;
  const me = entries.find((e) => e.user.id === input.me.id) ?? null;
  const shown = input.meOutside ? entries.filter((e) => e.user.id !== input.me.id) : entries;
  // 보유자 없음도 빈 결과를 캐시에 저장한 것처럼 synced_at·stale을 그대로 준다(D235)
  if (entries.length === 0) {
    return GetPlaytimeRankingResponse.parse({
      items: [],
      next_cursor: null,
      app: { app_id: input.appId, name: null },
      total: 0,
      me: null,
      ...input.cache,
      playtime_synced_at: null,
    });
  }
  return GetPlaytimeRankingResponse.parse({
    items: shown.slice(0, RANKING_ITEMS_MAX),
    next_cursor: null,
    app: { app_id: input.appId, name: app?.name ?? null },
    total: entries.length,
    me,
    ...input.cache,
    playtime_synced_at: kstIso(syncedAt),
  });
}

function rotate<T>(xs: readonly T[], k: number): T[] {
  if (xs.length === 0) return [];
  const n = k % xs.length;
  return [...xs.slice(n), ...xs.slice(0, n)];
}

// -----------------------------------------------------------------------------
// 홈 community(bot_presence 흉내)
// -----------------------------------------------------------------------------

const MOCK_PLAYING: readonly BotPresencePlaying[] = [
  { name: 'League of Legends', game: 'lol', steam_app_id: null, count: 8 },
  { name: 'Teamfight Tactics', game: 'tft', steam_app_id: null, count: 4 },
  { name: 'PUBG: BATTLEGROUNDS', game: 'steam', steam_app_id: 578080, count: 4 },
  { name: 'Lethal Company', game: 'steam', steam_app_id: 1966720, count: 3 },
  { name: 'Counter-Strike 2', game: 'steam', steam_app_id: 730, count: 2 },
  { name: 'Valorant', game: null, steam_app_id: null, count: 1 },
];

/** 접속 현황 1행. none → 없음 */
export function mockPresence(bot: MockBotScenario, now: number): { capturedAt: number; voiceMemberCount: number; playing: readonly BotPresencePlaying[] } | null {
  if (bot === 'none') return null;
  if (bot === 'stale') return { capturedAt: now - 20 * MIN * 1000, voiceMemberCount: 17, playing: MOCK_PLAYING };
  return { capturedAt: now - 40 * 1000, voiceMemberCount: 23, playing: bot === 'no_playing' ? [] : MOCK_PLAYING };
}

/** 요약 community(계약 8절). 계산 규칙은 core presenceState·nowPlayingItems */
export function mockCommunity(input: { bot: MockBotScenario; now: number; logs: readonly MockActivityLog[] }): DashboardCommunity {
  const nowDate = new Date(input.now);
  const p = mockPresence(input.bot, input.now);
  const state = presenceState({ capturedAt: p ? new Date(p.capturedAt) : null, now: nowDate });
  const voice: DashboardCommunity['voice'] =
    state === 'live' && p
      ? { state: 'live', member_count: p.voiceMemberCount, captured_at: new Date(p.capturedAt).toISOString() }
      : state === 'stale' && p
        ? { state: 'stale', member_count: null, captured_at: new Date(p.capturedAt).toISOString() }
        : { state: 'not_connected', member_count: null, captured_at: null };
  const connected = input.logs.length > 0 || p !== null;
  const week = kstWeekWindow(nowDate);
  // voice·chat만 센다(D240). 봇 연결 여부(connected)는 play를 포함한 모든 기록으로 본다(수신은 된 것이므로)
  const activeCount = new Set(
    input.logs
      .filter((l) => COUNTED.has(l.type) && l.startedAt >= week.start.getTime() && l.startedAt < week.end.getTime())
      .map((l) => l.userId),
  ).size;
  const items = state === 'live' && p ? nowPlayingItems(p.playing) : [];
  return {
    voice,
    active_members: connected ? { state: 'ready', count: activeCount } : { state: 'not_connected', count: null },
    now_playing: items.length > 0 && p ? { captured_at: new Date(p.capturedAt).toISOString(), items } : null,
  };
}
