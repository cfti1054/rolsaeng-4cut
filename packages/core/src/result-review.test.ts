import { describe, expect, it } from 'vitest';
import {
  SCRIM_ELO_K_BASE_DEFAULT,
  SCRIM_ELO_K_NEW_DEFAULT,
  SCRIM_ELO_LOSS_RATIO_DEFAULT,
  SCRIM_ELO_NEW_PLAYER_GAMES_DEFAULT,
  SCRIM_RESULT_REVERT_WINDOW_DAYS,
  type ScrimPlayerStatus,
  type ScrimTeam,
} from '@gcd/shared';
import {
  DAY_MS,
  computePlacementEloUpdates,
  computeTeamEloUpdates,
  inferRevertOutcomes,
  planRatingRevert,
  revertBlockReason,
  selectRatedParticipants,
  type EloPolicy,
  type RatingOutcome,
  type RevertHistoryRow,
  type RevertRatingRow,
} from './index';

const policy: EloPolicy = {
  kBase: SCRIM_ELO_K_BASE_DEFAULT,
  kNew: SCRIM_ELO_K_NEW_DEFAULT,
  newPlayerGames: SCRIM_ELO_NEW_PLAYER_GAMES_DEFAULT,
  lossRatio: SCRIM_ELO_LOSS_RATIO_DEFAULT,
};
const T0 = new Date('2026-11-01T03:00:00.000Z');
const toObj = (m: Map<string, RatingOutcome> | null) => (m === null ? null : Object.fromEntries(m));

// -----------------------------------------------------------------------------
describe('inferRevertOutcomes', () => {
  const teams = new Map<string, ScrimTeam | null>([
    ['b1', 'blue'],
    ['b2', 'blue'],
    ['o1', 'orange'],
    ['o2', 'orange'],
  ]);

  it('팀: 블루 승 → 블루 win, 오렌지 loss', () => {
    const r = inferRevertOutcomes({ ratedUserIds: ['b1', 'b2', 'o1', 'o2'], winnerTeam: 'blue', teamByUser: teams, placements: null });
    expect(toObj(r)).toEqual({ b1: 'win', b2: 'win', o1: 'loss', o2: 'loss' });
  });

  it('팀: 오렌지 승', () => {
    const r = inferRevertOutcomes({ ratedUserIds: ['b1', 'o1'], winnerTeam: 'orange', teamByUser: teams, placements: null });
    expect(toObj(r)).toEqual({ b1: 'loss', o1: 'win' });
  });

  it('팀: rated user의 team이 null → null', () => {
    const t = new Map(teams).set('x', null);
    expect(inferRevertOutcomes({ ratedUserIds: ['b1', 'x'], winnerTeam: 'blue', teamByUser: t, placements: null })).toBeNull();
  });

  it('팀: rated user가 teamByUser에 없음 → null', () => {
    expect(inferRevertOutcomes({ ratedUserIds: ['b1', 'ghost'], winnerTeam: 'blue', teamByUser: teams, placements: null })).toBeNull();
  });

  it('팀: rated에 없는 사람의 team은 상관없다(null이어도)', () => {
    const t = new Map(teams).set('bench', null);
    expect(toObj(inferRevertOutcomes({ ratedUserIds: ['b1', 'o1'], winnerTeam: 'blue', teamByUser: t, placements: null }))).toEqual({
      b1: 'win',
      o1: 'loss',
    });
  });

  it('개인: 4명 중 3명만 rated(1위 노쇼 제외) → 1..3 재순위, M=3에서 1위 win·2·3위 loss', () => {
    const placements = [
      { userId: 'noshow', placement: 1 },
      { userId: 'a', placement: 2 },
      { userId: 'b', placement: 3 },
      { userId: 'c', placement: 4 },
    ];
    const r = inferRevertOutcomes({ ratedUserIds: ['a', 'b', 'c'], winnerTeam: null, teamByUser: new Map(), placements });
    expect(toObj(r)).toEqual({ a: 'win', b: 'loss', c: 'loss' });
  });

  it('개인: 같은 placement는 입력 순서로 순위를 매긴다', () => {
    const placements = [
      { userId: 'b', placement: 1 },
      { userId: 'a', placement: 1 },
      { userId: 'c', placement: 2 },
      { userId: 'd', placement: 3 },
    ];
    // 재순위 b=1, a=2, c=3, d=4 → M=4 상위 2명 win
    const r = inferRevertOutcomes({ ratedUserIds: ['a', 'b', 'c', 'd'], winnerTeam: null, teamByUser: new Map(), placements });
    expect(toObj(r)).toEqual({ b: 'win', a: 'win', c: 'loss', d: 'loss' });
    // M=3이면 첫 입력(b)만 win
    const r3 = inferRevertOutcomes({ ratedUserIds: ['a', 'b', 'd'], winnerTeam: null, teamByUser: new Map(), placements });
    expect(toObj(r3)).toEqual({ b: 'win', a: 'loss', d: 'loss' });
  });

  it('개인: rated user가 placements에 없음 → null', () => {
    const placements = [
      { userId: 'a', placement: 1 },
      { userId: 'b', placement: 2 },
    ];
    expect(inferRevertOutcomes({ ratedUserIds: ['a', 'b', 'c'], winnerTeam: null, teamByUser: new Map(), placements })).toBeNull();
  });

  it('개인: placement가 유한한 숫자가 아님 → null', () => {
    const placements = [
      { userId: 'a', placement: Number.NaN },
      { userId: 'b', placement: 2 },
    ];
    expect(inferRevertOutcomes({ ratedUserIds: ['a', 'b'], winnerTeam: null, teamByUser: new Map(), placements })).toBeNull();
  });

  it('개인: 같은 user가 placements에 두 번이면 첫 항목만 쓴다(selectRatedParticipants와 같음)', () => {
    const placements = [
      { userId: 'a', placement: 3 },
      { userId: 'b', placement: 2 },
      { userId: 'a', placement: 1 },
    ];
    expect(toObj(inferRevertOutcomes({ ratedUserIds: ['a', 'b'], winnerTeam: null, teamByUser: new Map(), placements }))).toEqual({
      b: 'win',
      a: 'loss',
    });
  });

  it('롤체 8명: 상위 4명 win', () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
    const placements = [...ids].reverse().map((u) => ({ userId: u, placement: Number(u.slice(1)) }));
    const r = inferRevertOutcomes({ ratedUserIds: ids, winnerTeam: null, teamByUser: new Map(), placements });
    expect(toObj(r)).toEqual({ p1: 'win', p2: 'win', p3: 'win', p4: 'win', p5: 'loss', p6: 'loss', p7: 'loss', p8: 'loss' });
  });

  it('winnerTeam·placements 둘 다 null → null, 둘 다 값 → null', () => {
    expect(inferRevertOutcomes({ ratedUserIds: ['b1'], winnerTeam: null, teamByUser: teams, placements: null })).toBeNull();
    expect(
      inferRevertOutcomes({
        ratedUserIds: ['b1'],
        winnerTeam: 'blue',
        teamByUser: teams,
        placements: [{ userId: 'b1', placement: 1 }],
      }),
    ).toBeNull();
  });

  it('ratedUserIds 중복 → null', () => {
    expect(inferRevertOutcomes({ ratedUserIds: ['b1', 'b1', 'o1'], winnerTeam: 'blue', teamByUser: teams, placements: null })).toBeNull();
  });

  it('ratedUserIds가 비면 빈 Map', () => {
    expect(inferRevertOutcomes({ ratedUserIds: [], winnerTeam: 'blue', teamByUser: teams, placements: null })?.size).toBe(0);
  });

  it('입력을 바꾸지 않는다', () => {
    const placements = [
      { userId: 'b', placement: 2 },
      { userId: 'a', placement: 1 },
    ];
    const snapshot = JSON.stringify(placements);
    inferRevertOutcomes({ ratedUserIds: ['a', 'b'], winnerTeam: null, teamByUser: new Map(), placements });
    expect(JSON.stringify(placements)).toBe(snapshot);
  });
});

// -----------------------------------------------------------------------------
// 왕복: S3 승인(selectRatedParticipants → compute*EloUpdates)의 outcome = inferRevertOutcomes,
// 그리고 승인 결과를 planRatingRevert로 되돌리면 승인 전 ratings로 돌아간다.
describe('inferRevertOutcomes·planRatingRevert 왕복(S3 승인과 대조)', () => {
  type Player = { userId: string; status: ScrimPlayerStatus; team: ScrimTeam | null };
  const before = new Map<string, RevertRatingRow>();
  const ratingOf = (u: string, i: number): RevertRatingRow =>
    before.get(u) ?? { userId: u, elo: 950 + i * 37, wins: i % 3, losses: (i * 2) % 5 };

  function approveAndRevert(
    updates: ReturnType<typeof computeTeamEloUpdates>,
    startRatings: RevertRatingRow[],
    outcomes: Map<string, RatingOutcome>,
  ) {
    const afterRatings: RevertRatingRow[] = startRatings.map((r) => {
      const u = updates.find((x) => x.userId === r.userId)!;
      return {
        userId: r.userId,
        elo: u.eloAfter,
        wins: r.wins + (u.outcome === 'win' ? 1 : 0),
        losses: r.losses + (u.outcome === 'loss' ? 1 : 0),
      };
    });
    const history: RevertHistoryRow[] = updates.map((u, i) => ({
      id: `h${i}`,
      userId: u.userId,
      eloBefore: u.eloBefore,
      eloAfter: u.eloAfter,
      createdAt: T0,
    }));
    return planRatingRevert({ history, ratings: [...afterRatings].reverse(), outcomes });
  }

  it('팀 5:5(벤치·노쇼·팀 없음 섞임)', () => {
    const players: Player[] = [
      { userId: 'u1', status: 'joined', team: 'blue' },
      { userId: 'u2', status: 'joined', team: 'orange' },
      { userId: 'u3', status: 'no_show', team: 'blue' },
      { userId: 'u4', status: 'joined', team: 'blue' },
      { userId: 'u5', status: 'joined', team: 'orange' },
      { userId: 'u6', status: 'joined', team: null },
      { userId: 'u7', status: 'joined', team: 'blue' },
      { userId: 'u8', status: 'joined', team: 'orange' },
    ];
    const sel = selectRatedParticipants({ hasTeams: true, players, placements: null });
    if (sel.kind !== 'teams') throw new Error('teams 기대');
    const all = [...sel.blue, ...sel.orange];
    const start = all.map((u, i) => ratingOf(u, i));
    const rp = (u: string, i: number) => ({ userId: u, elo: start.find((r) => r.userId === u)!.elo, gamesPlayed: i * 4 });
    const updates = computeTeamEloUpdates({
      blue: sel.blue.map(rp),
      orange: sel.orange.map(rp),
      winner: 'orange',
      policy,
    });

    const teamByUser = new Map(players.map((p) => [p.userId, p.team] as const));
    const outcomes = inferRevertOutcomes({ ratedUserIds: updates.map((u) => u.userId), winnerTeam: 'orange', teamByUser, placements: null });
    expect(outcomes).not.toBeNull();
    for (const u of updates) expect(outcomes!.get(u.userId)).toBe(u.outcome);

    const plan = approveAndRevert(updates, start, outcomes!);
    expect(plan).toEqual({ ok: true, updates: start.map((r) => ({ ...r })) });
  });

  it('개인: 1위가 노쇼(제외)된 롤체 8명', () => {
    const players: Player[] = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'].map((u) => ({
      userId: u,
      status: u === 't3' ? 'no_show' : 'joined',
      team: null,
    }));
    const placements = [
      { userId: 't5', placement: 4 },
      { userId: 't3', placement: 1 },
      { userId: 't1', placement: 2 },
      { userId: 't8', placement: 8 },
      { userId: 't2', placement: 3 },
      { userId: 't7', placement: 7 },
      { userId: 't4', placement: 5 },
      { userId: 't6', placement: 6 },
    ];
    const sel = selectRatedParticipants({ hasTeams: false, players, placements });
    if (sel.kind !== 'placements') throw new Error('placements 기대');
    const start = sel.ranked.map((p, i) => ratingOf(p.userId, i));
    const updates = computePlacementEloUpdates({
      players: sel.ranked.map((p, i) => ({ userId: p.userId, elo: start[i]!.elo, gamesPlayed: i * 3, placement: p.placement })),
      policy,
    });
    expect(updates).toHaveLength(7);

    const outcomes = inferRevertOutcomes({
      ratedUserIds: updates.map((u) => u.userId).reverse(),
      winnerTeam: null,
      teamByUser: new Map(),
      placements,
    });
    expect(outcomes).not.toBeNull();
    for (const u of updates) expect(outcomes!.get(u.userId)).toBe(u.outcome);
    expect([...outcomes!.values()].filter((o) => o === 'win')).toHaveLength(3); // M=7 → 상위 3명

    const plan = approveAndRevert(updates, start, outcomes!);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      const byUser = new Map(plan.updates.map((x) => [x.userId, x]));
      for (const r of start) expect(byUser.get(r.userId)).toEqual(r);
    }
  });

  it('개인: 같은 placement가 섞인 4명(입력 순서 동점 처리까지 일치)', () => {
    const players: Player[] = ['a', 'b', 'c', 'd'].map((u) => ({ userId: u, status: 'joined', team: null }));
    const placements = [
      { userId: 'c', placement: 2 },
      { userId: 'a', placement: 2 },
      { userId: 'd', placement: 1 },
      { userId: 'b', placement: 9 },
    ];
    const sel = selectRatedParticipants({ hasTeams: false, players, placements });
    if (sel.kind !== 'placements') throw new Error('placements 기대');
    const updates = computePlacementEloUpdates({
      players: sel.ranked.map((p) => ({ userId: p.userId, elo: 1000, gamesPlayed: 0, placement: p.placement })),
      policy,
    });
    const outcomes = inferRevertOutcomes({ ratedUserIds: ['a', 'b', 'c', 'd'], winnerTeam: null, teamByUser: new Map(), placements });
    for (const u of updates) expect(outcomes!.get(u.userId)).toBe(u.outcome);
    expect(toObj(outcomes)).toEqual({ d: 'win', c: 'win', a: 'loss', b: 'loss' });
  });
});

// -----------------------------------------------------------------------------
describe('revertBlockReason', () => {
  const W = SCRIM_RESULT_REVERT_WINDOW_DAYS;
  const base = {
    approvedAt: T0,
    now: new Date(T0.getTime() + DAY_MS),
    windowDays: W,
    submittedById: 'submitter',
    actorId: 'admin',
    seasonClosed: false,
    laterGameUserIds: [] as string[],
  };

  it('문제 없으면 null', () => {
    expect(revertBlockReason(base)).toBeNull();
  });

  it('각 이유 단독', () => {
    expect(revertBlockReason({ ...base, actorId: 'submitter' })).toBe('self_submitted');
    expect(revertBlockReason({ ...base, now: new Date(T0.getTime() + W * DAY_MS) })).toBe('window_passed');
    expect(revertBlockReason({ ...base, seasonClosed: true })).toBe('season_closed');
    expect(revertBlockReason({ ...base, laterGameUserIds: ['u1'] })).toBe('later_games');
  });

  it('둘 이상이면 우선순위 self_submitted → window_passed → season_closed → later_games', () => {
    const all = {
      ...base,
      actorId: 'submitter',
      now: new Date(T0.getTime() + 30 * DAY_MS),
      seasonClosed: true,
      laterGameUserIds: ['u1'],
    };
    expect(revertBlockReason(all)).toBe('self_submitted');
    expect(revertBlockReason({ ...all, actorId: 'admin' })).toBe('window_passed');
    expect(revertBlockReason({ ...all, actorId: 'admin', now: base.now })).toBe('season_closed');
    expect(revertBlockReason({ ...all, actorId: 'admin', now: base.now, seasonClosed: false })).toBe('later_games');
  });

  it('기한 경계: approvedAt + 7일 − 1ms 허용, 정확히 7일 막음', () => {
    expect(W).toBe(7);
    expect(revertBlockReason({ ...base, now: new Date(T0.getTime() + 7 * DAY_MS - 1) })).toBeNull();
    expect(revertBlockReason({ ...base, now: new Date(T0.getTime() + 7 * DAY_MS) })).toBe('window_passed');
  });

  it('승인 직후(now = approvedAt)는 허용', () => {
    expect(revertBlockReason({ ...base, now: T0 })).toBeNull();
  });

  it('승인자 본인(= actor)이어도 제출자가 아니면 null', () => {
    // actorId가 승인자 'approver'와 같다. 함수는 승인자를 보지 않는다
    expect(revertBlockReason({ ...base, actorId: 'approver' })).toBeNull();
  });

  it('이력 없음(seasonClosed false·later []) → 기한·본인만 본다', () => {
    const noHistory = { ...base, seasonClosed: false, laterGameUserIds: [] };
    expect(revertBlockReason(noHistory)).toBeNull();
    expect(revertBlockReason({ ...noHistory, actorId: 'submitter' })).toBe('self_submitted');
    expect(revertBlockReason({ ...noHistory, now: new Date(T0.getTime() + 8 * DAY_MS) })).toBe('window_passed');
  });

  it('잘못된 입력은 RangeError', () => {
    expect(() => revertBlockReason({ ...base, now: new Date(Number.NaN) })).toThrow(RangeError);
    expect(() => revertBlockReason({ ...base, windowDays: -1 })).toThrow(RangeError);
  });
});

// -----------------------------------------------------------------------------
describe('planRatingRevert', () => {
  const h = (userId: string, eloBefore: number, eloAfter: number): RevertHistoryRow => ({
    id: `h-${userId}`,
    userId,
    eloBefore,
    eloAfter,
    createdAt: T0,
  });

  it('정상 팀 2명', () => {
    const r = planRatingRevert({
      history: [h('b', 1000, 1016), h('o', 1000, 992)],
      ratings: [
        { userId: 'o', elo: 992, wins: 3, losses: 2 },
        { userId: 'b', elo: 1016, wins: 5, losses: 1 },
      ],
      outcomes: new Map([
        ['b', 'win'],
        ['o', 'loss'],
      ]),
    });
    expect(r).toEqual({
      ok: true,
      updates: [
        { userId: 'b', elo: 1000, wins: 4, losses: 1 },
        { userId: 'o', elo: 1000, wins: 3, losses: 1 },
      ],
    });
  });

  it('정상 개인 3명(history 입력 순서)', () => {
    const r = planRatingRevert({
      history: [h('c', 1100, 1090), h('a', 900, 920), h('b', 1000, 995)],
      ratings: [
        { userId: 'a', elo: 920, wins: 1, losses: 0 },
        { userId: 'b', elo: 995, wins: 0, losses: 4 },
        { userId: 'c', elo: 1090, wins: 2, losses: 2 },
      ],
      outcomes: new Map<string, RatingOutcome>([
        ['a', 'win'],
        ['b', 'loss'],
        ['c', 'loss'],
      ]),
    });
    expect(r).toEqual({
      ok: true,
      updates: [
        { userId: 'c', elo: 1100, wins: 2, losses: 1 },
        { userId: 'a', elo: 900, wins: 0, losses: 0 },
        { userId: 'b', elo: 1000, wins: 0, losses: 3 },
      ],
    });
  });

  it('elo ≠ eloAfter 1명 → 실패, 그 user만', () => {
    const r = planRatingRevert({
      history: [h('a', 1000, 1016), h('b', 1000, 992)],
      ratings: [
        { userId: 'a', elo: 1016, wins: 1, losses: 0 },
        { userId: 'b', elo: 1000, wins: 0, losses: 1 },
      ],
      outcomes: new Map<string, RatingOutcome>([
        ['a', 'win'],
        ['b', 'loss'],
      ]),
    });
    expect(r).toEqual({ ok: false, reason: 'rating_mismatch', userIds: ['b'] });
  });

  it('ratings 행 없음 → 실패', () => {
    const r = planRatingRevert({
      history: [h('a', 1000, 1016), h('b', 1000, 992)],
      ratings: [{ userId: 'a', elo: 1016, wins: 1, losses: 0 }],
      outcomes: new Map<string, RatingOutcome>([
        ['a', 'win'],
        ['b', 'loss'],
      ]),
    });
    expect(r).toEqual({ ok: false, reason: 'rating_mismatch', userIds: ['b'] });
  });

  it('wins 0인데 win → 실패, losses 0인데 loss → 실패', () => {
    const r = planRatingRevert({
      history: [h('a', 1000, 1016), h('b', 1000, 992)],
      ratings: [
        { userId: 'a', elo: 1016, wins: 0, losses: 3 },
        { userId: 'b', elo: 992, wins: 2, losses: 0 },
      ],
      outcomes: new Map<string, RatingOutcome>([
        ['a', 'win'],
        ['b', 'loss'],
      ]),
    });
    expect(r).toEqual({ ok: false, reason: 'rating_mismatch', userIds: ['a', 'b'] });
  });

  it('outcome 없음 → 실패', () => {
    const r = planRatingRevert({
      history: [h('a', 1000, 1016)],
      ratings: [{ userId: 'a', elo: 1016, wins: 1, losses: 0 }],
      outcomes: new Map(),
    });
    expect(r).toEqual({ ok: false, reason: 'rating_mismatch', userIds: ['a'] });
  });

  it('이력 user 중복 → 실패(userIds에 한 번만)', () => {
    const r = planRatingRevert({
      history: [h('a', 1000, 1016), h('b', 1000, 992), { ...h('a', 1000, 1016), id: 'h-a2' }],
      ratings: [
        { userId: 'a', elo: 1016, wins: 2, losses: 0 },
        { userId: 'b', elo: 992, wins: 0, losses: 1 },
      ],
      outcomes: new Map<string, RatingOutcome>([
        ['a', 'win'],
        ['b', 'loss'],
      ]),
    });
    expect(r).toEqual({ ok: false, reason: 'rating_mismatch', userIds: ['a'] });
  });

  it('ratings에 같은 user 행이 둘 → 실패', () => {
    const r = planRatingRevert({
      history: [h('a', 1000, 1016)],
      ratings: [
        { userId: 'a', elo: 1016, wins: 1, losses: 0 },
        { userId: 'a', elo: 1016, wins: 1, losses: 0 },
      ],
      outcomes: new Map<string, RatingOutcome>([['a', 'win']]),
    });
    expect(r).toEqual({ ok: false, reason: 'rating_mismatch', userIds: ['a'] });
  });

  it('0경기로 돌아가도 성공(elo = eloBefore, 행 유지)', () => {
    const r = planRatingRevert({
      history: [h('a', 1000, 1020)],
      ratings: [{ userId: 'a', elo: 1020, wins: 1, losses: 0 }],
      outcomes: new Map<string, RatingOutcome>([['a', 'win']]),
    });
    expect(r).toEqual({ ok: true, updates: [{ userId: 'a', elo: 1000, wins: 0, losses: 0 }] });
  });

  it('이력이 비면 ok + []', () => {
    expect(planRatingRevert({ history: [], ratings: [], outcomes: new Map() })).toEqual({ ok: true, updates: [] });
  });

  it('입력을 바꾸지 않는다', () => {
    const ratings = [{ userId: 'a', elo: 1020, wins: 1, losses: 0 }];
    planRatingRevert({ history: [h('a', 1000, 1020)], ratings, outcomes: new Map<string, RatingOutcome>([['a', 'win']]) });
    expect(ratings).toEqual([{ userId: 'a', elo: 1020, wins: 1, losses: 0 }]);
  });
});
