import type { GameView } from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import {
  eloEmptyNote,
  eloEmptyState,
  eloRecordText,
  eloRuleText,
  meRowOutside,
  parseRankingsQuery,
  podiumOrder,
  seasonFallbackLabel,
  rankChangeView,
  rankingGames,
  rankingStatusText,
  resolveRankingGame,
  topRankersEmptyText,
  tierRowText,
} from './rankings';
import { routes } from './routes';

const q = (s: string) => new URLSearchParams(s);
const SEASON = '11111111-1111-4111-8111-111111111111';
const g = (code: GameView['code'], sort_order: number) => ({ code, sort_order }) as GameView;

describe('랭킹 URL 쿼리', () => {
  it('기본 탭은 ELO, 잘못된 값은 무시', () => {
    const none = { period: null, appId: null };
    expect(parseRankingsQuery(q(''))).toEqual({ tab: 'elo', game: null, season: null, ...none });
    expect(parseRankingsQuery(q('tab=nope&game=nope&season=x'))).toEqual({ tab: 'elo', game: null, season: null, ...none });
    expect(parseRankingsQuery(q(`tab=tier&game=tft&season=${SEASON}`))).toEqual({ tab: 'tier', game: 'tft', season: SEASON, ...none });
  });
  it('routes.rankings: 기본 탭은 주소에 쓰지 않는다', () => {
    expect(routes.rankings()).toBe('/rankings');
    expect(routes.rankings({ tab: 'elo', game: 'lol' })).toBe('/rankings?game=lol');
    expect(routes.rankings({ tab: 'tier', game: 'tft' })).toBe('/rankings?tab=tier&game=tft');
  });
  it('티어 탭은 랭크 큐가 있는 게임만, sort_order 순. 고를 수 없는 게임이면 첫 게임', () => {
    const games = [g('steam', 3), g('tft', 2), g('lol', 1)];
    expect(rankingGames('tier', games).map((x) => x.code)).toEqual(['lol', 'tft']);
    expect(rankingGames('elo', games).map((x) => x.code)).toEqual(['lol', 'tft', 'steam']);
    expect(resolveRankingGame('steam', rankingGames('tier', games))).toBe('lol');
    expect(resolveRankingGame('steam', rankingGames('elo', games))).toBe('steam');
    expect(resolveRankingGame(null, [])).toBeNull();
  });
});

describe('갱신 상태', () => {
  const at = '2026-10-30T14:05:00.000Z'; // KST 23:05
  it('주기 문구는 상수에서, 시각은 KST', () => {
    expect(rankingStatusText({ synced_at: at, stale: false })).toEqual({ text: '5분마다 갱신 · 23:05', tone: 'ok' });
  });
  it('stale → 갱신 지연', () => {
    expect(rankingStatusText({ synced_at: at, stale: true })).toEqual({ text: '갱신 지연 · 마지막 23:05', tone: 'warn' });
  });
  it('is_final이 stale보다 앞선다, 시각 없으면 null', () => {
    expect(rankingStatusText({ synced_at: at, stale: false, is_final: true })?.text).toBe('시즌 최종 순위');
    expect(rankingStatusText({ synced_at: null, stale: false })).toBeNull();
  });
});

describe('규칙·빈 상태 문구는 응답 min_games를 쓴다', () => {
  const season = { id: SEASON, name: '시즌 1', starts_at: '2026-01-01T00:00:00.000Z', ends_at: '2026-04-01T00:00:00.000Z' };
  it('규칙', () => {
    expect(eloRuleText({ min_games: 7, is_final: false })).toBe('7경기 이상 치른 멤버만 표시 · 동점이면 승률 순');
    expect(eloRuleText({ min_games: 7, is_final: true })).toBe('시즌 종료 때 확정된 순위 · 동점이면 승률 순');
  });
  it('빈 상태 4경우', () => {
    const base = { min_games: 7, is_final: false, synced_at: '2026-01-01T00:00:00.000Z', season };
    expect(eloEmptyState(base)).toBe('7경기 이상 치른 멤버가 아직 없어요');
    expect(eloEmptyState({ ...base, season: null })).toBe('아직 시즌이 없어요');
    expect(eloEmptyState({ ...base, synced_at: null })).toBe('아직 시작하지 않은 시즌이에요');
    expect(eloEmptyState({ ...base, is_final: true })).toBe('이 시즌에 순위에 든 멤버가 없어요');
  });
  it('홈 상위 랭커 없음은 시즌 없음과 계산 실패를 구분한다', () => {
    expect(topRankersEmptyText('no_season')).toBe('아직 시즌이 없어요');
    expect(topRankersEmptyText('unavailable')).toBe('순위를 불러오지 못했어요');
  });
});

describe('빈 상태 보조 문구', () => {
  const season = { id: SEASON, name: '시즌 1', starts_at: '2026-01-01T00:00:00.000Z', ends_at: '2026-04-01T00:00:00.000Z' };
  it('종료 시즌에는 앞으로 쌓인다는 안내가 없다', () => {
    const before = Date.parse(season.ends_at) - 1;
    expect(eloEmptyNote({ season, is_final: true }, before)).toBeNull();
    expect(eloEmptyNote({ season, is_final: false }, before)).toBe('운영진이 내전/모집 결과를 승인하면 순위가 쌓여요.');
    expect(eloEmptyNote({ season: null, is_final: false }, before)).toBe('첫 내전/모집 결과가 승인되면 시즌이 시작돼요.');
  });
  it('끝났지만 종료 처리 전 시즌(ends_at <= now)도 없다, 시각을 모르면 내지 않는다', () => {
    const ends = Date.parse(season.ends_at);
    expect(eloEmptyNote({ season, is_final: false }, ends)).toBeNull();
    expect(eloEmptyNote({ season, is_final: false }, ends + 60_000)).toBeNull();
    expect(eloEmptyNote({ season, is_final: false }, null)).toBeNull();
  });
});

describe('표 값', () => {
  it('순위 변동: ▲·▼·— (0과 null은 같게)', () => {
    expect(rankChangeView(3)).toMatchObject({ text: '▲3', tone: 'up' });
    expect(rankChangeView(-2)).toMatchObject({ text: '▼2', tone: 'down' });
    expect(rankChangeView(0)).toMatchObject({ text: '—', tone: 'none' });
    expect(rankChangeView(null)).toMatchObject({ text: '—', tone: 'none' });
  });
  it('전적·티어 문구(목업 수치)', () => {
    expect(eloRecordText({ wins: 22, losses: 9, win_rate: 0.71 })).toBe('22승 9패 · 71%');
    expect(tierRowText({ tier: 'DIAMOND', division: 'II', lp: 45, wins: 1, losses: 1 })).toBe('Diamond II · 45 LP');
    expect(tierRowText({ tier: 'MASTER', division: null, lp: 210, wins: 1, losses: 1 })).toBe('Master · 210 LP');
  });
  it('상위 3명 배치 2·1·3, 3명 미만이면 있는 만큼', () => {
    const r = (...ranks: number[]) => ranks.map((rank) => ({ rank }));
    expect(podiumOrder(r(1, 2, 3, 4)).map((x) => [x.entry.rank, x.place])).toEqual([[2, 2], [1, 1], [3, 3]]);
    expect(podiumOrder(r(1, 2)).map((x) => x.place)).toEqual([2, 1]);
    expect(podiumOrder(r(1)).map((x) => x.place)).toEqual([1]);
    expect(podiumOrder([])).toEqual([]);
  });
  it('시상대는 응답 rank 기준: 공백이 있어도 라벨이 rank와 같고 3위 밖은 뺀다', () => {
    const r = (...ranks: number[]) => ranks.map((rank) => ({ rank }));
    expect(podiumOrder(r(2, 3, 4)).map((x) => [x.entry.rank, x.place])).toEqual([[2, 2], [3, 3]]);
    expect(podiumOrder(r(1, 3, 4)).map((x) => [x.entry.rank, x.place])).toEqual([[1, 1], [3, 3]]);
    expect(podiumOrder(r(4, 5))).toEqual([]);
  });
  it('시즌 select 대체 옵션: 목록에 있으면 없음, 응답 시즌이면 이름, 없는 시즌이면 —', () => {
    const items = [{ id: 'a' }];
    expect(seasonFallbackLabel(items, 'a', { id: 'a', name: '시즌 1' })).toBeNull();
    expect(seasonFallbackLabel(items, 'b', { id: 'b', name: '시즌 2' })).toBe('시즌 2');
    expect(seasonFallbackLabel(items, 'x', undefined)).toBe('—');
    expect(seasonFallbackLabel(items, 'x', { id: 'b', name: '시즌 2' })).toBe('—');
  });
  it('내 행이 items 안이면 추가하지 않는다', () => {
    const a = { user: { id: 'a' } };
    const b = { user: { id: 'b' } };
    expect(meRowOutside([a], a)).toBeNull();
    expect(meRowOutside([a], b)).toBe(b);
    expect(meRowOutside([a], null)).toBeNull();
  });
});
