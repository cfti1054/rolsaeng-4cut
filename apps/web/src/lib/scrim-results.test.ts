import type { ScrimPlayerView } from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import {
  balanceSubtitle,
  buildPlacements,
  placementPathUser,
  pruneDraft,
  splitValidationDetails,
  teamPathUser,
  tooFewPlayersText,
  buildTeamsRequest,
  eloPreviewText,
  pendingResultText,
  percent1,
  primaryRating,
  ratingChartData,
  ratingRecordText,
  recentScrimRole,
  resultFlowText,
  resultPanelState,
  rosterKey,
  signed,
  skillFormulaText,
} from './scrim-results';

const uid = (n: number) => `5c0f0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const player = (n: number, extra: Partial<ScrimPlayerView> = {}): ScrimPlayerView => ({
  user: { id: uid(n), nickname: `p${n}`, avatar_url: null },
  status: 'joined',
  is_host: n === 1,
  preferred_positions: [],
  joined_at: '2026-10-28T00:00:00.000Z',
  position: null,
  team: null,
  no_show_marked_at: null,
  position_preference: null,
  skill: 1000,
  is_new: false,
  ...extra,
});

describe('S3 표시 문구', () => {
  it('부호(U+2212)·퍼센트', () => {
    expect(signed(16)).toBe('+16');
    expect(signed(-15)).toBe('−15');
    expect(signed(0)).toBe('0');
    expect(percent1(0.574)).toBe('57.4%');
    expect(percent1(0.5)).toBe('50.0%');
    expect(eloPreviewText({ win: 12, lose: -20 })).toEqual({ win: '+12', lose: '−20' });
    expect(eloPreviewText(null)).toBeNull();
  });

  it('밸런스 부제·실력값 설명(정책 값이 없으면 숫자 없음)', () => {
    expect(balanceSubtitle({ partitions_evaluated: 126, used_positions: true, options: [{}, {}, {}] as never })).toBe(
      '126가지 팀 구성 × 포지션 배정 중 비용이 가장 낮은 3개 안',
    );
    expect(balanceSubtitle({ partitions_evaluated: 35, used_positions: false, options: [{}] as never })).toBe('35가지 팀 구성 중 비용이 가장 낮은 1개 안');
    expect(skillFormulaText(null)).not.toMatch(/\d/);
    expect(skillFormulaText({ k_base: 24, k_new: 36, new_player_games: 5, full_weight_games: 10 })).toContain('K = 24, 신규 멤버 K = 36');
  });

  it('결과 문구', () => {
    expect(resultFlowText(true)).toBe('방장 입력 → 운영진 승인 → 레이팅 반영');
    expect(resultFlowText(false)).toBe('방장 입력 → 운영진 승인');
    expect(pendingResultText({ winner_team: 'blue' }, true)).toBe('블루팀 승리로 제출했어요. 운영진이 승인하면 레이팅이 반영됩니다.');
    expect(pendingResultText({ winner_team: null }, false)).toBe('순위를 제출했어요. 운영진이 승인하면 결과가 확정돼요.');
  });
});

describe('S3 입력 검사', () => {
  it('팀 직접 수정: 빈 팀·포지션 누락·중복', () => {
    const ps = [player(1, { preferred_positions: ['top'] }), player(2), player(3), player(4, { status: 'no_show' })];
    const positions = ['top', 'mid'];
    expect(buildTeamsRequest(ps, { [uid(1)]: { team: 'blue', position: 'top' } }, true, positions).issues).toContain('오렌지팀에 1명 이상 넣어 주세요.');
    const dup = buildTeamsRequest(
      ps,
      { [uid(1)]: { team: 'blue', position: 'top' }, [uid(2)]: { team: 'blue', position: 'top' }, [uid(3)]: { team: 'orange', position: null } },
      true,
      positions,
    );
    expect(dup.body).toBeNull();
    expect(dup.issues.join(' ')).toMatch(/두 명/);
    expect(dup.issues.join(' ')).toMatch(/포지션을 모두/);
    const ok = buildTeamsRequest(
      ps,
      { [uid(1)]: { team: 'blue', position: 'top' }, [uid(2)]: { team: 'orange', position: 'mid' }, [uid(4)]: { team: 'orange', position: 'top' } },
      true,
      positions,
    );
    // 노쇼(uid 4)는 보내지 않는다
    expect(ok.body).toEqual({ blue: [{ user_id: uid(1), position: 'top' }], orange: [{ user_id: uid(2), position: 'mid' }] });
    expect(buildTeamsRequest(ps, { [uid(1)]: { team: 'blue', position: 'top' }, [uid(2)]: { team: 'orange', position: null } }, false, []).body).toEqual({
      blue: [{ user_id: uid(1), position: null }],
      orange: [{ user_id: uid(2), position: null }],
    });
  });

  it('순위 입력: 2명 이상, 동순위 금지, 1위부터 연속', () => {
    expect(buildPlacements({ a: 1, b: null }).issue).toMatch(/2명 이상/);
    expect(buildPlacements({ a: 1, b: 1 }).issue).toMatch(/같은 순위/);
    expect(buildPlacements({ a: 1, b: 3 }).issue).toMatch(/빈 순위/);
    expect(buildPlacements({ a: 2, b: 1, c: null }).placements).toEqual([
      { user_id: 'b', placement: 1 },
      { user_id: 'a', placement: 2 },
    ]);
  });

  it('명단 키는 joined 집합만(노쇼·순서 무관)', () => {
    expect(rosterKey([player(2), player(1), player(3, { status: 'no_show' })])).toBe(rosterKey([player(1), player(2)]));
  });
});

describe('S3 RESULT 영역 상태', () => {
  const viewer = { is_host: false, can_submit_result: false, can_edit_teams: false } as never;
  const base = { status: 'playing', result: null, viewer, balance: null, game: { has_teams: true }, players: [] } as never as Parameters<typeof resultPanelState>[0];
  it('상태별 분기', () => {
    expect(resultPanelState({ ...base, status: 'full' }).kind).toBe('before');
    expect(resultPanelState({ ...base, status: 'cancelled' }).kind).toBe('cancelled');
    expect(resultPanelState(base).kind).toBe('waiting');
    expect(resultPanelState({ ...base, viewer: { ...(viewer as object), is_host: true } as never }).kind).toBe('need_teams');
    expect(resultPanelState({ ...base, viewer: { ...(viewer as object), can_submit_result: true } as never }).kind).toBe('input');
    const r = { status: 'rejected' } as never;
    const st = resultPanelState({ ...base, result: r, viewer: { ...(viewer as object), can_submit_result: true } as never });
    expect(st).toEqual({ kind: 'input', rejected: r });
    expect(resultPanelState({ ...base, result: { status: 'pending' } as never }).kind).toBe('pending');
    expect(resultPanelState({ ...base, status: 'finished', result: { status: 'approved' } as never }).kind).toBe('approved');
    expect(resultPanelState({ ...base, status: 'finished' }).kind).toBe('no_result');
  });
});

describe('S3 프로필', () => {
  it('대표 레이팅 = 경기 수 최다(같으면 앞), 승률 문구', () => {
    const a = { game: 'lol', elo: 1421, wins: 17, losses: 11, games: 28, win_rate: 0.607 } as const;
    const b = { game: 'tft', elo: 1100, wins: 1, losses: 1, games: 28, win_rate: 0.5 } as const;
    expect(primaryRating([a, b])).toBe(a);
    expect(primaryRating([])).toBeNull();
    expect(ratingRecordText(a)).toBe('17승 11패 · 승률 61%');
    expect(ratingRecordText({ wins: 0, losses: 0, win_rate: null })).toBe('아직 경기 없음');
  });

  it('그래프: 첫 점 elo_before, 이후 elo_after, 상승·하락', () => {
    const pts = [
      { scrim_id: uid(1), scrim_title: 'a', at: '2026-10-01T00:00:00.000Z', elo_before: 1400, elo_after: 1416, delta: 16 },
      { scrim_id: uid(2), scrim_title: 'b', at: '2026-10-02T00:00:00.000Z', elo_before: 1416, elo_after: 1399, delta: -17 },
    ];
    expect(ratingChartData(pts).map((d) => [d.elo, d.up])).toEqual([
      [1400, null],
      [1416, true],
      [1399, false],
    ]);
    expect(ratingChartData([])).toEqual([]);
  });

  it('최근 내전 보조 줄: 순위 우선, 포지션 라벨', () => {
    expect(recentScrimRole({ position: null, placement: 3 })).toBe('3위');
    expect(recentScrimRole({ position: 'top', placement: null })).toBe('탑');
    expect(recentScrimRole({ position: null, placement: null })).toBeNull();
  });
});

describe('S3 QA 반영(minor 2·5·6)', () => {
  it('순위 draft는 현재 joined 명단으로 정리', () => {
    expect(pruneDraft({ a: 1, gone: 2 }, ['a', 'new'])).toEqual({ a: 1, new: null });
  });

  it('VALIDATION_FAILED details → 행 키 / 하단', () => {
    const body = { blue: [{ user_id: uid(1), position: 'top' }], orange: [{ user_id: uid(2), position: null }] };
    expect(teamPathUser(body, 'orange.0.position')).toBe(uid(2));
    expect(teamPathUser(body, 'blue')).toBeNull();
    expect(placementPathUser({ placements: [{ user_id: 'a' }, { user_id: 'b' }] }, 'placements.1.user_id')).toBe('b');
    const r = splitValidationDetails(
      [
        { path: 'blue.0.user_id', message: 'x' },
        { path: 'blue', message: 'y' },
      ],
      (p) => teamPathUser(body, p),
    );
    expect(r).toEqual({ byKey: { [uid(1)]: ['x'] }, rest: ['y'] });
  });

  it('개인 순위 게임 joined 2명 미만: 방장·운영진에게 too_few', () => {
    const viewer = { is_host: false, can_submit_result: false, can_edit_teams: false } as never;
    const s = { status: 'playing', result: null, viewer, balance: null, game: { has_teams: false }, players: [player(1)] } as never as Parameters<typeof resultPanelState>[0];
    expect(resultPanelState(s).kind).toBe('waiting');
    expect(resultPanelState(s, { isAdmin: true }).kind).toBe('too_few');
    expect(resultPanelState({ ...s, viewer: { ...(viewer as object), is_host: true } as never }).kind).toBe('too_few');
    expect(tooFewPlayersText()).toBe('참가자가 2명 이상이어야 결과를 입력할 수 있어요');
  });
});
