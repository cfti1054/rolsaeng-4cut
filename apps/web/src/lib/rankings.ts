import {
  GameCode,
  RANKING_CACHE_INTERVAL_MIN,
  RATING_START_ELO,
  TierRankingGame,
  Uuid,
  type EloRankingEntry,
  type GameView,
  type GetEloRankingResponse,
  type TierRankingEntry,
} from '@gcd/shared';
import { formatClock } from './format';
import { tierLabel } from './tiers';

/**
 * S4 랭킹 화면 로직(순수 함수, 단위 테스트 대상). 계약 10절.
 * 노출 기준 경기 수는 응답 min_games, 갱신 주기는 RANKING_CACHE_INTERVAL_MIN만 쓴다(D101).
 */

// -----------------------------------------------------------------------------
// 탭·URL 쿼리
// -----------------------------------------------------------------------------

export type RankingTab = 'tier' | 'elo';

/** 활성 탭. 기본은 ELO(목업). 설명 문구는 목업 그대로 */
export const RANKING_TABS: readonly { value: RankingTab; label: string; description: string }[] = [
  { value: 'tier', label: '티어', description: '라이엇 API 기준 솔로 랭크 티어 순위입니다. 연동 계정 동기화 때 갱신됩니다.' },
  {
    value: 'elo',
    label: '내전 ELO',
    description: `티어와 상관없이 모두 ${RATING_START_ELO}점에서 시작하는 서버 자체 내전 점수입니다. 운영진이 승인한 결과만 반영되고, 시즌마다 새로 시작합니다.`,
  },
];

/** S5에서 열리는 탭. 숫자를 그리지 않는다 */
export const RANKING_DISABLED_TABS = [
  { value: 'activity', label: '활동' },
  { value: 'playtime', label: '플레이타임' },
] as const;
export const RANKING_DISABLED_NOTE = '봇 연동 후 제공';

export interface RankingsQuery {
  tab: RankingTab;
  game: GameCode | null;
  season: string | null;
}

/** 주소의 쿼리를 읽는다. 잘못된 값은 없는 것으로 친다 */
export function parseRankingsQuery(sp: { get(name: string): string | null }): RankingsQuery {
  const tab = sp.get('tab') === 'tier' ? 'tier' : 'elo';
  const game = GameCode.safeParse(sp.get('game') ?? undefined).data ?? null;
  const season = Uuid.safeParse(sp.get('season') ?? undefined).data ?? null;
  return { tab, game, season };
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
  if (!r.season) return '첫 내전 결과가 승인되면 시즌이 시작돼요.';
  if (r.is_final || now === null || Date.parse(r.season.ends_at) <= now) return null;
  return '운영진이 내전 결과를 승인하면 순위가 쌓여요.';
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
