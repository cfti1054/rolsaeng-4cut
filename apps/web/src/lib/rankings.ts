import {
  ActivityPeriod,
  GameCode,
  RANKING_CACHE_INTERVAL_MIN,
  RATING_START_ELO,
  SteamAppId,
  TierRankingGame,
  Uuid,
  type ActivityRankingEntry,
  type EloRankingEntry,
  type GameView,
  type GetActivityRankingResponse,
  type GetEloRankingResponse,
  type PlaytimeRankingEntry,
  type SteamAppOption,
  type TierRankingEntry,
  pickDefaultPlaytimeAppId,
} from '@gcd/shared';
import { z } from 'zod';
import { formatClock, formatMonthDay } from './format';
import { GAME_SCRIM_META } from './games';
import { tierLabel } from './tiers';

/**
 * S4 랭킹 화면 로직(순수 함수, 단위 테스트 대상). 계약 10절.
 * 노출 기준 경기 수는 응답 min_games, 갱신 주기는 RANKING_CACHE_INTERVAL_MIN만 쓴다(D101).
 */

// -----------------------------------------------------------------------------
// 탭·URL 쿼리
// -----------------------------------------------------------------------------

export type RankingTab = 'tier' | 'elo' | 'activity' | 'playtime';
const RankingTabValue = z.enum(['tier', 'elo', 'activity', 'playtime']);

/** 탭 4개(S5부터 모두 활성). 기본은 ELO(목업). 설명 문구는 목업·계약 S5 10절 */
export const RANKING_TABS: readonly { value: RankingTab; label: string; description: string }[] = [
  { value: 'tier', label: '티어', description: '라이엇 API 기준 솔로 랭크 티어 순위입니다. 연동 계정 동기화 때 갱신됩니다.' },
  {
    value: 'elo',
    label: '내전/모집 ELO',
    description: `티어와 상관없이 모두 ${RATING_START_ELO}점에서 시작하는 서버 자체 내전/모집 점수입니다. 운영진이 승인한 결과만 반영되고, 시즌마다 새로 시작합니다.`,
  },
  // 음성만 센다(D232)
  { value: 'activity', label: '활동', description: '디스코드 음성 채널 접속 시간 합계예요.' },
  { value: 'playtime', label: '플레이타임', description: '스팀 게임별 누적 플레이타임이에요. 프로필이 공개된 멤버만 집계돼요.' },
];

export interface RankingsQuery {
  tab: RankingTab;
  game: GameCode | null;
  season: string | null;
  /** 활동 탭 기간. 없거나 잘못되면 null(= week) */
  period: ActivityPeriod | null;
  /** 플레이타임 탭 게임. 없거나 잘못되면 null(= pickDefaultPlaytimeAppId(목록)) */
  appId: number | null;
}

/** 주소의 쿼리를 읽는다. 잘못된 값은 없는 것으로 친다 */
export function parseRankingsQuery(sp: { get(name: string): string | null }): RankingsQuery {
  const tab = RankingTabValue.safeParse(sp.get('tab') ?? undefined).data ?? 'elo';
  const game = GameCode.safeParse(sp.get('game') ?? undefined).data ?? null;
  const season = Uuid.safeParse(sp.get('season') ?? undefined).data ?? null;
  const period = ActivityPeriod.safeParse(sp.get('period') ?? undefined).data ?? null;
  const rawApp = sp.get('app_id');
  // 「12abc」「1e3」「 12」 같은 값은 숫자로 바뀌어도 받지 않는다(정수 문자열만)
  const appId = rawApp !== null && /^[1-9]\d*$/.test(rawApp) ? (SteamAppId.safeParse(Number(rawApp)).data ?? null) : null;
  return { tab, game, season, period, appId };
}

/** 표시 순서대로 고른 게임 목록 + 현재 선택. 티어 탭은 랭크 큐가 있는 게임만 */
export function rankingGames(tab: RankingTab, games: readonly GameView[]): GameView[] {
  const list = [...games].sort((a, b) => a.sort_order - b.sort_order);
  return tab === 'tier' ? list.filter((g) => TierRankingGame.safeParse(g.code).success) : list;
}

/** 주소의 게임이 이 탭에서 고를 수 없으면 첫 게임 */
export function resolveRankingGame(picked: GameCode | null, options: readonly GameView[]): GameCode | null {
  if (picked && options.some((g) => g.code === picked)) return picked;
  return options[0]?.code ?? null;
}

// -----------------------------------------------------------------------------
// 갱신 상태
// -----------------------------------------------------------------------------

export type RankingStatusTone = 'ok' | 'warn' | 'final';

/** 머리 오른쪽 알약. 시작 전 시즌처럼 시각이 없으면 null */
export function rankingStatusText(r: { synced_at: string | null; stale: boolean; is_final?: boolean }): { text: string; tone: RankingStatusTone } | null {
  if (r.is_final) return { text: '시즌 최종 순위', tone: 'final' };
  if (!r.synced_at) return null;
  if (r.stale) return { text: `갱신 지연 · 마지막 ${formatClock(r.synced_at)}`, tone: 'warn' };
  return { text: `${RANKING_CACHE_INTERVAL_MIN}분마다 갱신 · ${formatClock(r.synced_at)}`, tone: 'ok' };
}

// -----------------------------------------------------------------------------
// 규칙·빈 상태 문구
// -----------------------------------------------------------------------------

export const TIER_RULE_TEXT = '티어 점수 = 티어 × 400 + 디비전 × 100 + LP';
export const TIER_EMPTY_TEXT = '라이엇 계정을 연동한 멤버가 아직 없어요';
export const SEASON_NONE_TEXT = '아직 시즌이 없어요';
export const TOP_RANKERS_UNAVAILABLE_TEXT = '순위를 불러오지 못했어요';

/** 홈 상위 랭커가 없을 때. no_season과 unavailable을 같은 문구로 두지 않는다(21절) */
export function topRankersEmptyText(state: 'no_season' | 'unavailable'): string {
  return state === 'unavailable' ? TOP_RANKERS_UNAVAILABLE_TEXT : SEASON_NONE_TEXT;
}

/** 종료 시즌은 그때 확정된 순위라, 지금 설정값 min_games를 기준처럼 보이면 틀릴 수 있다(계약 13절) */
export function eloRuleText(r: Pick<GetEloRankingResponse, 'min_games' | 'is_final'>): string {
  if (r.is_final) return '시즌 종료 때 확정된 순위 · 동점이면 승률 순';
  return `${r.min_games}경기 이상 치른 멤버만 표시 · 동점이면 승률 순`;
}

export function eloEmptyText(minGames: number): string {
  return `${minGames}경기 이상 치른 멤버가 아직 없어요`;
}

/** ELO 빈 상태. season null → 시즌 없음, 시작 전(synced_at null) → 시작 전, 종료 시즌 → 순위 없음 */
export function eloEmptyState(r: Pick<GetEloRankingResponse, 'season' | 'synced_at' | 'is_final' | 'min_games'>): string {
  if (!r.season) return SEASON_NONE_TEXT;
  if (r.is_final) return '이 시즌에 순위에 든 멤버가 없어요';
  if (!r.synced_at) return '아직 시작하지 않은 시즌이에요';
  return eloEmptyText(r.min_games);
}

/**
 * ELO 빈 상태 보조 문구. 끝난 시즌은 더 쌓이지 않으므로 없다. 종료 처리 전(is_final false)이어도
 * ends_at이 지났으면 승인은 다음 시즌으로 간다(D116). now를 아직 모르면 문구를 내지 않는다.
 */
export function eloEmptyNote(r: Pick<GetEloRankingResponse, 'season' | 'is_final'>, now: number | null): string | null {
  if (!r.season) return '첫 내전/모집 결과가 승인되면 시즌이 시작돼요.';
  if (r.is_final || now === null || Date.parse(r.season.ends_at) <= now) return null;
  return '운영진이 내전/모집 결과를 승인하면 순위가 쌓여요.';
}

// -----------------------------------------------------------------------------
// 표 값
// -----------------------------------------------------------------------------

/** 양수 `▲n`, 음수 `▼n`, 0·null `—`(D153) */
export function rankChangeView(change: number | null): { text: string; tone: 'up' | 'down' | 'none'; label: string } {
  if (change === null || change === 0) return { text: '—', tone: 'none', label: '순위 변동 없음' };
  if (change > 0) return { text: `▲${change}`, tone: 'up', label: `${change}계단 상승` };
  return { text: `▼${Math.abs(change)}`, tone: 'down', label: `${Math.abs(change)}계단 하락` };
}

/** 「22승 9패 · 71%」 */
export function eloRecordText(e: Pick<EloRankingEntry, 'wins' | 'losses' | 'win_rate'>): string {
  return `${e.wins}승 ${e.losses}패 · ${Math.round(e.win_rate * 100)}%`;
}

/** 「Diamond II · 45 LP」 */
export function tierRowText(e: Pick<TierRankingEntry, 'tier' | 'division' | 'lp' | 'wins' | 'losses'>): string {
  return `${tierLabel(e)} · ${e.lp} LP`;
}

/**
 * 상위 3명 배치: 2·1·3. 라벨은 응답 rank를 따른다. 종료 시즌은 삭제된 멤버 자리를 다시 매기지 않아(계약 4-2)
 * 2위부터 시작할 수 있고, 그때 1위 자리는 비운다. 3위 밖은 넣지 않는다.
 */
export function podiumOrder<T extends { rank: number }>(items: readonly T[]): { entry: T; place: 1 | 2 | 3 }[] {
  const at = (place: 1 | 2 | 3) => items.find((e) => e.rank === place);
  return ([2, 1, 3] as const).flatMap((place) => {
    const entry = at(place);
    return entry ? [{ entry, place }] : [];
  });
}

/**
 * 시즌 select에서 목록에 없는 값의 옵션 글자. 목록에 있으면 null.
 * 응답의 시즌이면 이름(다른 운영진의 승인으로 생긴 시즌이 /seasons 캐시에 아직 없을 때), 아니면 `—`(없는 시즌).
 */
export function seasonFallbackLabel(items: readonly { id: string }[], value: string, shown: { id: string; name: string } | null | undefined): string | null {
  if (items.some((s) => s.id === value)) return null;
  return shown?.id === value ? shown.name : '—';
}

/** 내 행이 items 밖이면 맨 아래에 붙일 행, 안에 있으면 null */
export function meRowOutside<T extends { user: { id: string } }>(items: readonly T[], me: T | null): T | null {
  if (!me || items.some((e) => e.user.id === me.user.id)) return null;
  return me;
}

// -----------------------------------------------------------------------------
// S5 활동·플레이타임(계약 S5 10절)
// -----------------------------------------------------------------------------

export const ACTIVITY_RULE_TEXT = '한국 시간 기준 · 주는 월요일 시작 · 기간에 시작한 음성 접속만 집계';
/** 활동 표 SCRIMS 열 머리 툴팁(참고 열, 정렬 무관, D239) */
export const ACTIVITY_SCRIMS_HINT = '결과가 승인된 내전 참가 수';
export const PLAYTIME_RULE_TEXT = '하루 1회 새벽 5시 동기화 · 프로필이 공개된 멤버만';
export const ACTIVITY_BOT_NOT_CONNECTED_TEXT = '디스코드 봇이 아직 연결되지 않았어요';
export const PLAYTIME_NO_APPS_TEXT = '스팀 계정을 연동한 멤버가 아직 없어요';
export const PLAYTIME_APP_EMPTY_TEXT = '이 게임 플레이 기록이 있는 멤버가 없어요';

const PERIOD_NAME: Record<ActivityPeriod, string> = { week: '이번 주', month: '이번 달' };
const PERIOD_PREV: Record<ActivityPeriod, string> = { week: '지난주', month: '지난달' };

/**
 * 기간 select 글자. 응답이 그 기간 것이면 날짜를 붙인다: 「이번 주 (10.26 – 11.01)」「이번 달 (10월)」.
 * 날짜는 응답 period_start ~ period_end − 1ms(배타적 끝). 응답이 없거나 다른 기간이면 이름만.
 */
export function activityPeriodLabel(period: ActivityPeriod, r: Pick<GetActivityRankingResponse, 'period' | 'period_start' | 'period_end'> | undefined): string {
  const name = PERIOD_NAME[period];
  if (!r || r.period !== period) return name;
  if (period === 'week') {
    const last = new Date(Date.parse(r.period_end) - 1).toISOString();
    return `${name} (${formatMonthDay(r.period_start)} – ${formatMonthDay(last)})`;
  }
  return `${name} (${Number(formatMonthDay(r.period_start).slice(0, 2))}월)`;
}

/** 활동 빈 상태 제목. 봇 미연결과 「기록 없음」을 구분한다(D228) */
export function activityEmptyText(r: Pick<GetActivityRankingResponse, 'bot_connected' | 'period'>): string {
  if (!r.bot_connected) return ACTIVITY_BOT_NOT_CONNECTED_TEXT;
  return `${PERIOD_NAME[r.period]} 음성 접속 기록이 아직 없어요`;
}

/** 활동 탭 +/− 의미(D216): 직전 기간 최종 순위 대비 */
export function activityChangeHint(period: ActivityPeriod): string {
  return `${PERIOD_PREV[period]} 대비`;
}

/** 「31h 20m」. 분 아래는 내린다, 분은 두 자리(목업 「27h 05m」) */
export function activityTimeText(totalSec: number): string {
  const min = Math.floor(Math.max(0, totalSec) / 60);
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
}

/** 「7일 중 6일 활동」 */
export function activeDaysText(periodDays: number, activeDays: number): string {
  return `${periodDays}일 중 ${activeDays}일 활동`;
}

/** SCRIMS 열 「3회」. 0도 실제 값이라 「0회」(D239) */
export function scrimCountText(scrimCount: number): string {
  return `${scrimCount}회`;
}

/**
 * 모바일 PLAYER 보조 줄(MAIN GAME·SCRIMS 열이 숨는 폭): 「7일 중 6일 활동 · 내전 3회」. 내전 0회면 뒷부분 생략.
 * 주 게임은 별도 줄(mainGamesLine)로, 없으면 줄을 만들지 않는다(QA s5_web #3)
 */
export function activityMobileSubText(periodDays: number, e: Pick<ActivityRankingEntry, 'active_days' | 'scrim_count'>): string {
  const days = activeDaysText(periodDays, e.active_days);
  return e.scrim_count > 0 ? `${days} · 내전 ${scrimCountText(e.scrim_count)}` : days;
}

/** 모바일 보조 줄·상위 3명용 주 게임 글자. 없으면 빈 문자열(「—」 한 줄 금지) */
export function mainGamesLine(e: Pick<ActivityRankingEntry, 'main_games'>): string {
  return e.main_games.length === 0 ? '' : mainGamesText(e);
}

/** 주 게임 이름을 「 · 」로 잇는다(다른 화면처럼 게임 코드의 짧은 이름, 모르는 코드는 응답 name). 없으면 「—」 */
export function mainGamesText(e: Pick<ActivityRankingEntry, 'main_games'>): string {
  return e.main_games.length === 0 ? '—' : e.main_games.map((g) => GAME_SCRIM_META[g.code]?.label ?? g.name).join(' · ');
}

/** 「18시간」 = floor(minutes_recent / 60) */
export function playtimeRecentText(e: Pick<PlaytimeRankingEntry, 'minutes_recent'>): string {
  return `${Math.floor(e.minutes_recent / 60)}시간`;
}

/** 「2,140h」 = floor(minutes_total / 60), 천 단위 쉼표 */
export function playtimeTotalText(e: Pick<PlaytimeRankingEntry, 'minutes_total'>): string {
  return `${Math.floor(e.minutes_total / 60).toLocaleString('en-US')}h`;
}

/** 머리 보조 「스팀 동기화 10.31 05:02」. 값이 없으면 null */
export function playtimeSyncedText(playtimeSyncedAt: string | null): string | null {
  return playtimeSyncedAt ? `스팀 동기화 ${formatMonthDay(playtimeSyncedAt)} ${formatClock(playtimeSyncedAt)}` : null;
}

/**
 * 플레이타임 기본 게임 = shared pickDefaultPlaytimeAppId(보유자 1명 이상인 첫 항목, D234). 목록을 모르면 undefined.
 * 주소 app_id 생략 판단(「기본값과 같으면 쓰지 않음」)도 이 값과 비교한다.
 */
export function defaultPlaytimeApp(apps: readonly SteamAppOption[] | undefined): number | null | undefined {
  return apps ? pickDefaultPlaytimeAppId(apps) : undefined;
}

/**
 * 플레이타임 게임 선택. 주소의 app_id가 있으면 목록에 없어도 그 게임(봇 web_url·공유 링크), 없으면 기본 게임.
 * 기본값이 null(목록 빔)이면 null(빈 상태). 목록을 아직 모르거나 받지 못했으면 주소 값 또는 null.
 */
export function resolvePlaytimeApp(picked: number | null, apps: readonly SteamAppOption[] | undefined): number | null {
  const def = defaultPlaytimeApp(apps);
  if (def === null) return null;
  if (picked !== null) return picked;
  return def ?? null;
}

/** select에서 고른 값 → 주소 app_id. 기본 게임과 같으면 null(주소에 쓰지 않음) */
export function playtimeAppParam(picked: number, apps: readonly SteamAppOption[] | undefined): number | null {
  return picked === defaultPlaytimeApp(apps) ? null : picked;
}

/** 게임 select에서 목록에 없는 app_id의 옵션 글자(응답 이름, 없으면 「App {id}」). 목록에 있으면 null */
export function playtimeAppFallbackLabel(apps: readonly SteamAppOption[], appId: number, shown: { app_id: number; name: string | null } | undefined): string | null {
  if (apps.some((a) => a.app_id === appId)) return null;
  return shown?.app_id === appId && shown.name ? shown.name : `App ${appId}`;
}
