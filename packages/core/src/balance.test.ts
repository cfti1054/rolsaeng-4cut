import { describe, expect, it } from 'vitest';
import { BALANCE_ELO_WEIGHT_MAX, BALANCE_FULL_WEIGHT_GAMES, BALANCE_OPTIONS_MAX, RATING_START_ELO } from '@gcd/shared';
import {
  balanceEloWeight,
  balanceTeams,
  BALANCE_POSITION_COST_WEIGHT,
  bestPositionAssignment,
  computeSkill,
  evaluateTeams,
  expectedScore,
  POSITION_PREFERENCE_COST,
  positionPreferenceOf,
  validatePlacementUsers,
  validateTeamAssignment,
  type BalancePlayer,
} from './index';

const LOL = ['top', 'jungle', 'mid', 'adc', 'support'] as const;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const p = (userId: string, skill: number, preferredPositions: readonly string[] = [], rating = skill): BalancePlayer => ({
  userId,
  skill,
  rating,
  preferredPositions,
});

function randomPlayers(rnd: () => number, n: number, withPrefs: boolean): BalancePlayer[] {
  return Array.from({ length: n }, (_, i) => {
    const prefs: string[] = [];
    if (withPrefs) {
      const k = Math.floor(rnd() * 3); // 0–2지망
      const pool = [...LOL];
      for (let j = 0; j < k; j++) prefs.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]!);
    }
    // 동점이 자주 나도록 50 단위
    return p(`u${String(i).padStart(2, '0')}`, 800 + 50 * Math.floor(rnd() * 12), prefs, 900 + Math.floor(rnd() * 400));
  });
}

// ---------------------------------------------------------------------------
// 기준 구현(브루트포스): 모든 2^n 배정에서 players[0]이 블루, 블루 인원 ∈ {⌊n/2⌋, ⌈n/2⌉},
// 포지션은 모든 순열을 다 만든 뒤 최소 비용 → 사전순.
// ---------------------------------------------------------------------------
function allInjections(k: number, m: number): number[][] {
  if (k === 0) return [[]];
  const out: number[][] = [];
  for (const rest of allInjections(k - 1, m)) {
    for (let j = 0; j < m; j++) if (!rest.includes(j)) out.push([...rest, j]);
  }
  return out;
}

function refAssign(team: BalancePlayer[], positions: readonly string[]): { cost: number; seq: number[] } {
  let best: { cost: number; seq: number[] } | null = null;
  for (const seq of allInjections(team.length, positions.length)) {
    const cost = seq.reduce((s, j, i) => s + POSITION_PREFERENCE_COST[positionPreferenceOf(team[i]!.preferredPositions, positions[j]!)], 0);
    if (!best || cost < best.cost || (cost === best.cost && seq.join(',') < best.seq.join(','))) {
      // seq 원소는 한 자리(포지션 < 10)라 문자열 비교 = 사전순
      best = { cost, seq };
    }
  }
  return best!;
}

function refBalance(players: BalancePlayer[], usePositions: boolean, positions: readonly string[]) {
  const n = players.length;
  const sizes = new Set([Math.floor(n / 2), Math.ceil(n / 2)]);
  const rows: { blue: number[]; total: number; diff: number; pos: number; blueIds: string[]; orangeIds: string[] }[] = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    if (!(mask & 1)) continue;
    const blue: number[] = [];
    const orange: number[] = [];
    for (let i = 0; i < n; i++) (mask & (1 << i) ? blue : orange).push(i);
    if (!sizes.has(blue.length) || blue.length + orange.length !== n || orange.length === 0) continue;
    const avg = (ix: number[]) => ix.reduce((s, i) => s + players[i]!.skill, 0) / ix.length;
    const diff = (Math.abs(avg(blue) - avg(orange)) * n) / 2;
    const pos = usePositions
      ? refAssign(blue.map((i) => players[i]!), positions).cost + refAssign(orange.map((i) => players[i]!), positions).cost
      : 0;
    rows.push({
      blue,
      total: diff + BALANCE_POSITION_COST_WEIGHT * pos,
      diff,
      pos,
      blueIds: blue.map((i) => players[i]!.userId).sort(),
      orangeIds: orange.map((i) => players[i]!.userId).sort(),
    });
  }
  const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9;
  rows.sort((a, b) => {
    if (!near(a.total, b.total)) return a.total - b.total;
    if (!near(a.diff, b.diff)) return a.diff - b.diff;
    if (!near(a.pos, b.pos)) return a.pos - b.pos;
    for (let i = 0; i < Math.min(a.blue.length, b.blue.length); i++) if (a.blue[i] !== b.blue[i]) return a.blue[i]! - b.blue[i]!;
    return a.blue.length - b.blue.length;
  });
  return rows;
}

const idsOf = (members: { userId: string }[]) => members.map((m) => m.userId).sort();

describe('balanceEloWeight (D187)', () => {
  it('w = 0.2 × min(현재 시즌 경기 수, 10) ÷ 10', () => {
    expect(BALANCE_ELO_WEIGHT_MAX).toBe(0.2);
    expect(BALANCE_FULL_WEIGHT_GAMES).toBe(10);
    expect(balanceEloWeight(0)).toBe(0);
    expect(balanceEloWeight(1)).toBe(0.02);
    expect(balanceEloWeight(5)).toBe(0.1);
    expect(balanceEloWeight(10)).toBe(0.2);
    expect(balanceEloWeight(11)).toBe(0.2);
  });
  it.each([-1, 1.5, Number.NaN])('0 이상 정수가 아니면 RangeError (%s)', (g) => {
    expect(() => balanceEloWeight(g)).toThrow(RangeError);
  });
});

describe('computeSkill (D187, 20-3 표)', () => {
  it.each([
    [1800, 1000, 0, 1800],
    [1800, 1000, 1, 1784],
    [1800, 1000, 5, 1720],
    [1800, 1000, 10, 1640],
    [1800, 1000, 25, 1640],
    [600, 1400, 10, 760],
    [1200, 1500, 10, 1260],
    [1000, null, 0, 1000],
    [1800, null, 3, 1752],
  ] as const)('tierSeed %s, seasonElo %s, seasonGames %s → %s', (tierSeed, seasonElo, seasonGames, skill) => {
    expect(computeSkill({ seasonElo, seasonGames, tierSeed })).toBe(skill);
  });
  it('seasonElo null은 RATING_START_ELO로 본다', () => {
    expect(RATING_START_ELO).toBe(1000);
    expect(computeSkill({ seasonElo: null, seasonGames: 3, tierSeed: 1800 })).toBe(
      computeSkill({ seasonElo: RATING_START_ELO, seasonGames: 3, tierSeed: 1800 }),
    );
  });
  it.each([-1, 1.5, Number.NaN])('seasonGames 범위 오류 RangeError (%s)', (g) => {
    expect(() => computeSkill({ seasonElo: null, seasonGames: g, tierSeed: 1000 })).toThrow(RangeError);
  });
});

describe('positionPreferenceOf', () => {
  it('1지망·2지망·그 외, 비용 0/1/3', () => {
    expect(positionPreferenceOf(['mid', 'top'], 'mid')).toBe('first');
    expect(positionPreferenceOf(['mid', 'top'], 'top')).toBe('second');
    expect(positionPreferenceOf(['mid', 'top'], 'adc')).toBe('other');
    expect(positionPreferenceOf([], 'adc')).toBe('other');
    expect(POSITION_PREFERENCE_COST).toEqual({ first: 0, second: 1, other: 3 });
  });
});

describe('bestPositionAssignment', () => {
  it('최소 비용 배정', () => {
    const r = bestPositionAssignment(
      [p('a', 0, ['mid', 'top']), p('b', 0, ['mid', 'adc']), p('c', 0, ['support'])],
      LOL,
    );
    // a mid(0)·b adc(1) 또는 a top(1)·b mid(0) → 동점 1, 사전순(a의 index 작은 쪽): a top(0), b mid(2)
    expect(r).toEqual({ positions: ['top', 'mid', 'support'], cost: 1 });
  });
  it('희망 없음 → 전원 그 외, 사전순 첫 배정', () => {
    expect(bestPositionAssignment([p('a', 0), p('b', 0)], LOL)).toEqual({ positions: ['top', 'jungle'], cost: 6 });
  });
  it('0명 → [], 0 / 인원 > 포지션 → RangeError', () => {
    expect(bestPositionAssignment([], LOL)).toEqual({ positions: [], cost: 0 });
    expect(() => bestPositionAssignment([p('a', 0), p('b', 0)], ['top'])).toThrow(RangeError);
  });
  it('무작위: 전체 순열 기준 구현과 같다', () => {
    const rnd = mulberry32(11);
    for (let t = 0; t < 200; t++) {
      const k = Math.floor(rnd() * 6);
      const team = randomPlayers(rnd, k, true);
      const ref = refAssign(team, LOL);
      const got = bestPositionAssignment(team, LOL);
      expect(got.cost).toBe(ref.cost);
      expect(got.positions).toEqual(ref.seq.map((j) => LOL[j]));
    }
  });
});

describe('balanceTeams (D108)', () => {
  it('10명 → 126가지, 서로 다른 나누기 3안, 비용 오름차순', () => {
    const players = Array.from({ length: 10 }, (_, i) => p(`u${i}`, 1000 + i * 37));
    const r = balanceTeams({ players, usePositions: false, positions: [] });
    expect(r.partitionsEvaluated).toBe(126);
    expect(r.options).toHaveLength(BALANCE_OPTIONS_MAX);
    const keys = r.options.map((o) => idsOf(o.blue.members).join(','));
    expect(new Set(keys).size).toBe(3);
    for (let i = 1; i < r.options.length; i++) {
      expect(r.options[i]!.totalCost).toBeGreaterThanOrEqual(r.options[i - 1]!.totalCost);
    }
    for (const o of r.options) {
      expect(o.blue.members.map((m) => m.userId)).toContain('u0');
      expect(o.blue.members).toHaveLength(5);
      expect(o.orange.members).toHaveLength(5);
      expect(o.powerDiff).toBeCloseTo(Math.abs(o.blue.skillSum - o.orange.skillSum), 9);
      expect(o.positionCost).toBe(0);
      expect(o.totalCost).toBe(o.powerDiff);
      expect(o.blueWinProbability).toBe(expectedScore(o.blue.skillAvg, o.orange.skillAvg));
    }
  });

  // 성능 목표는 단독 실행 200ms 미만(계약 7-4). 다른 테스트 파일과 병렬로 돌면 벽시계가 흔들리므로
  // 워밍업 뒤 측정하고 회귀 감지용 상한(1000ms)으로만 단언한다(D137). 포지션 6개 이상의 지수 폭발(D134)은 이 상한에 걸린다
  const PERF_CEILING_MS = 1000;

  it('16명 → 6435가지, 성능 상한', () => {
    const rnd = mulberry32(3);
    const players = randomPlayers(rnd, 16, false);
    balanceTeams({ players, usePositions: false, positions: [] });
    const t0 = performance.now();
    const r = balanceTeams({ players, usePositions: false, positions: [] });
    const ms = performance.now() - t0;
    expect(r.partitionsEvaluated).toBe(6435);
    expect(ms).toBeLessThan(PERF_CEILING_MS);
  });

  it('10명 포지션 사용 성능(126 × 120 × 2) 상한', () => {
    const rnd = mulberry32(4);
    const players = randomPlayers(rnd, 10, true);
    balanceTeams({ players, usePositions: true, positions: LOL });
    const t0 = performance.now();
    const r = balanceTeams({ players, usePositions: true, positions: LOL });
    expect(performance.now() - t0).toBeLessThan(PERF_CEILING_MS);
    expect(r.partitionsEvaluated).toBe(126);
  });

  it('나누기 수: 짝수 C(n,n/2)/2, 홀수 C(n,⌊n/2⌋)', () => {
    const expected: Record<number, number> = { 2: 1, 3: 3, 4: 3, 5: 10, 6: 10, 7: 35, 8: 35, 9: 126, 10: 126, 11: 462, 16: 6435 };
    for (const [n, c] of Object.entries(expected)) {
      const players = Array.from({ length: Number(n) }, (_, i) => p(`u${i}`, 1000));
      expect(balanceTeams({ players, usePositions: false, positions: [] }).partitionsEvaluated).toBe(c);
    }
  });

  it('2명 → 1:1, 안 1개', () => {
    const r = balanceTeams({ players: [p('a', 1200), p('b', 1000)], usePositions: false, positions: [] });
    expect(r.partitionsEvaluated).toBe(1);
    expect(r.options).toHaveLength(1);
    expect(r.options[0]!.blue.members.map((m) => m.userId)).toEqual(['a']);
    expect(r.options[0]!.powerDiff).toBe(200);
  });

  it('4명 포지션 사용 → 2:2, 팀당 P(5,2)=20 중 최적', () => {
    const players = [p('a', 1000, ['mid']), p('b', 1000, ['mid', 'top']), p('c', 1000, ['adc']), p('d', 1000, ['adc', 'support'])];
    const r = balanceTeams({ players, usePositions: true, positions: LOL });
    expect(r.partitionsEvaluated).toBe(3);
    const best = r.options[0]!;
    // a·c / b·d 로 나누면 a mid, c adc, b mid, d adc → 비용 0
    expect(best.positionCost).toBe(0);
    expect(idsOf(best.blue.members)).toEqual(['a', 'c']);
    // members는 포지션 순서
    expect(best.blue.members).toEqual([
      { userId: 'a', position: 'mid', preference: 'first' },
      { userId: 'c', position: 'adc', preference: 'first' },
    ]);
    expect(best.orange.members.map((m) => m.position)).toEqual(['mid', 'adc']);
  });

  it('λ 효과: 전력 차 40 + 비용 0 < 전력 차 0 + 비용 1', () => {
    expect(BALANCE_POSITION_COST_WEIGHT).toBe(50);
    const positions = ['top', 'mid', 'jungle'];
    const players = [
      p('a', 1020, ['top']),
      p('b', 1000, ['mid']),
      p('c', 1000, ['mid', 'top']),
      p('d', 980, ['jungle']),
    ];
    // {a,b}|{c,d}: 차 40, 비용 0 → 40
    // {a,c}|{b,d}: 차 40, 비용 0 → 40 (동점, 블루 index [0,2] > [0,1])
    // {a,d}|{b,c}: 차 0, 비용 1(c top = 2지망) → 50
    const r = balanceTeams({ players, usePositions: true, positions });
    expect(r.options.map((o) => [idsOf(o.blue.members).join(','), o.powerDiff, o.positionCost, o.totalCost])).toEqual([
      ['a,b', 40, 0, 40],
      ['a,c', 40, 0, 40],
      ['a,d', 0, 1, 50],
    ]);
  });

  it('9명 홀수 → 4:5, 블루 = players[0] 쪽(작은 팀이든 큰 팀이든), 전력 차 = 평균 차 × n/2', () => {
    const players = Array.from({ length: 9 }, (_, i) => p(`u${i}`, 1000 + ((i * 53) % 200)));
    const r = balanceTeams({ players, usePositions: false, positions: [] });
    expect(r.partitionsEvaluated).toBe(126);
    for (const o of r.options) {
      expect(o.blue.members.some((m) => m.userId === 'u0')).toBe(true);
      expect([o.blue.members.length, o.orange.members.length].sort()).toEqual([4, 5]);
      expect(o.powerDiff).toBeCloseTo((Math.abs(o.blue.skillAvg - o.orange.skillAvg) * 9) / 2, 9);
    }
  });

  it('모든 실력값 동일 → 동점 규칙: 블루 index 수열 사전순', () => {
    const players = Array.from({ length: 6 }, (_, i) => p(`u${i}`, 1000));
    const r = balanceTeams({ players, usePositions: false, positions: [] });
    expect(r.options.map((o) => o.blue.members.map((m) => m.userId).sort())).toEqual([
      ['u0', 'u1', 'u2'],
      ['u0', 'u1', 'u3'],
      ['u0', 'u1', 'u4'],
    ]);
    // 포지션 미사용 members 순서 = skill DESC → userId ASC
    expect(r.options[0]!.blue.members.map((m) => m.userId)).toEqual(['u0', 'u1', 'u2']);
  });

  it('홀수 동점: 블루가 작은 팀 [0,1] < 큰 팀 [0,1,2]? 아니면 사전순 비교', () => {
    const players = Array.from({ length: 5 }, (_, i) => p(`u${i}`, 1000));
    const r = balanceTeams({ players, usePositions: false, positions: [] });
    // 모든 안 비용 0. index 수열: [0,1] < [0,1,2] < [0,1,3] …(접두가 같으면 짧은 쪽 먼저)
    expect(r.options.map((o) => idsOf(o.blue.members))).toEqual([
      ['u0', 'u1'],
      ['u0', 'u1', 'u2'],
      ['u0', 'u1', 'u3'],
    ]);
  });

  it('포지션 미사용 members = skill DESC → userId ASC, position·preference null', () => {
    const r = balanceTeams({
      players: [p('b', 1000), p('a', 1000), p('c', 1500), p('d', 1500)],
      usePositions: false,
      positions: [],
    });
    const best = r.options[0]!;
    for (const m of [...best.blue.members, ...best.orange.members]) {
      expect(m.position).toBeNull();
      expect(m.preference).toBeNull();
    }
    expect(best.blue.members.map((m) => m.userId)).toEqual(['c', 'b']);
  });

  it('결정적: 같은 입력 → 같은 결과', () => {
    const rnd = mulberry32(99);
    const players = randomPlayers(rnd, 10, true);
    const a = balanceTeams({ players, usePositions: true, positions: LOL });
    const b = balanceTeams({ players: players.map((x) => ({ ...x })), usePositions: true, positions: [...LOL] });
    expect(a).toEqual(b);
  });

  it('teamPlan 값: skillSum·skillAvg·ratingAvg(반올림 전), 홀수 동점 → index 사전순', () => {
    const r = balanceTeams({
      players: [p('a', 1001, [], 1500), p('b', 1000, [], 1000), p('c', 1000, [], 1001)],
      usePositions: false,
      positions: [],
    });
    // {a,b}|{c}: |1000.5 − 1000| × 1.5 = 0.75, {a,c}|{b}: 0.75(동점, [0,2] > [0,1]), {a}|{b,c}: 1.5
    expect(r.options.map((o) => [idsOf(o.blue.members).join(','), o.powerDiff])).toEqual([
      ['a,b', 0.75],
      ['a,c', 0.75],
      ['a', 1.5],
    ]);
    const best = r.options[0]!;
    expect(best.blue.skillSum).toBe(2001);
    expect(best.blue.skillAvg).toBe(1000.5);
    expect(best.blue.ratingAvg).toBe(1250);
    expect(best.orange.ratingAvg).toBe(1001);
  });

  it('maxOptions 지정, 경우의 수보다 크면 전부', () => {
    const players = Array.from({ length: 4 }, (_, i) => p(`u${i}`, 1000 + i));
    expect(balanceTeams({ players, usePositions: false, positions: [], maxOptions: 1 }).options).toHaveLength(1);
    expect(balanceTeams({ players, usePositions: false, positions: [], maxOptions: 10 }).options).toHaveLength(3);
  });

  it('입력 오류: 2명 미만·16명 초과·한 팀 > 포지션 수·userId 중복 → RangeError', () => {
    expect(() => balanceTeams({ players: [], usePositions: false, positions: [] })).toThrow(RangeError);
    expect(() => balanceTeams({ players: [p('a', 1)], usePositions: false, positions: [] })).toThrow(RangeError);
    expect(() =>
      balanceTeams({ players: Array.from({ length: 17 }, (_, i) => p(`u${i}`, 1)), usePositions: false, positions: [] }),
    ).toThrow(RangeError);
    // 11명 → 큰 팀 6 > 포지션 5
    expect(() =>
      balanceTeams({ players: Array.from({ length: 11 }, (_, i) => p(`u${i}`, 1)), usePositions: true, positions: LOL }),
    ).toThrow(RangeError);
    // 포지션 목록 빈 게임에서 usePositions
    expect(() => balanceTeams({ players: [p('a', 1), p('b', 1)], usePositions: true, positions: [] })).toThrow(RangeError);
    expect(() => balanceTeams({ players: [p('a', 1), p('a', 2)], usePositions: false, positions: [] })).toThrow(RangeError);
  });

  it('무작위 입력: 브루트포스 기준 구현과 상위 3안이 같다(포지션 미사용·사용, 짝·홀)', () => {
    const rnd = mulberry32(2026);
    for (let t = 0; t < 60; t++) {
      const usePositions = t % 2 === 0;
      const n = usePositions ? 2 + Math.floor(rnd() * 9) : 2 + Math.floor(rnd() * 11); // 포지션: 2–10, 미사용: 2–12
      const players = randomPlayers(rnd, n, usePositions);
      const got = balanceTeams({ players, usePositions, positions: LOL });
      const ref = refBalance(players, usePositions, LOL).slice(0, 3);
      expect(got.options.map((o) => idsOf(o.blue.members))).toEqual(ref.map((x) => x.blueIds));
      expect(got.options.map((o) => idsOf(o.orange.members))).toEqual(ref.map((x) => x.orangeIds));
      got.options.forEach((o, i) => {
        expect(o.totalCost).toBeCloseTo(ref[i]!.total, 9);
        expect(o.positionCost).toBe(ref[i]!.pos);
      });
    }
  });
});

describe('evaluateTeams', () => {
  it('저장된 포지션으로 비용·선호 계산, balanceTeams와 같은 공식', () => {
    const blue = [
      { ...p('a', 1100, ['mid']), position: 'mid' },
      { ...p('b', 1000, ['top', 'adc']), position: 'adc' },
    ];
    const orange = [
      { ...p('c', 1000, ['support']), position: 'top' },
      { ...p('d', 1000, []), position: null },
    ];
    const ev = evaluateTeams({ blue, orange, usePositions: true });
    expect(ev.blue.members).toEqual([
      { userId: 'a', position: 'mid', preference: 'first' },
      { userId: 'b', position: 'adc', preference: 'second' },
    ]);
    expect(ev.orange.members).toEqual([
      { userId: 'c', position: 'top', preference: 'other' },
      { userId: 'd', position: null, preference: null },
    ]);
    expect(ev.blue.positionCost).toBe(1);
    expect(ev.orange.positionCost).toBe(3);
    expect(ev.positionCost).toBe(4);
    expect(ev.powerDiff).toBe(100);
    expect(ev.blueWinProbability).toBe(expectedScore(1050, 1000));
  });

  it('포지션 미사용 → position·preference null, 비용 0. 홀수 인원 전력 차 = 평균 차 × n/2', () => {
    const ev = evaluateTeams({
      blue: [{ ...p('a', 1200, ['mid']), position: 'mid' }],
      orange: [
        { ...p('b', 1000), position: null },
        { ...p('c', 1100), position: null },
      ],
      usePositions: false,
    });
    expect(ev.blue.members[0]).toEqual({ userId: 'a', position: null, preference: null });
    expect(ev.positionCost).toBe(0);
    expect(ev.powerDiff).toBeCloseTo((Math.abs(1200 - 1050) * 3) / 2, 9);
  });

  it('balanceTeams 1안을 그대로 넣으면 같은 값', () => {
    const rnd = mulberry32(5);
    const players = randomPlayers(rnd, 10, true);
    const best = balanceTeams({ players, usePositions: true, positions: LOL }).options[0]!;
    const byId = new Map(players.map((x) => [x.userId, x]));
    const side = (ms: typeof best.blue.members) => ms.map((m) => ({ ...byId.get(m.userId)!, position: m.position }));
    const ev = evaluateTeams({ blue: side(best.blue.members), orange: side(best.orange.members), usePositions: true });
    expect(ev).toEqual({
      blue: best.blue,
      orange: best.orange,
      powerDiff: best.powerDiff,
      positionCost: best.positionCost,
      blueWinProbability: best.blueWinProbability,
    });
  });

  it('한 팀이 비면 RangeError', () => {
    expect(() => evaluateTeams({ blue: [], orange: [{ ...p('a', 1), position: null }], usePositions: false })).toThrow(
      RangeError,
    );
  });
});

describe('validateTeamAssignment', () => {
  const eligibleUserIds = ['a', 'b', 'c', 'd'];
  it('정상 → 빈 배열(미배정 허용)', () => {
    expect(
      validateTeamAssignment({
        eligibleUserIds,
        blue: [{ userId: 'a', position: 'top' }],
        orange: [{ userId: 'b', position: 'mid' }],
        usePositions: true,
        positions: LOL,
      }),
    ).toEqual([]);
    expect(
      validateTeamAssignment({
        eligibleUserIds,
        blue: [{ userId: 'a', position: null }],
        orange: [{ userId: 'b', position: null }],
        usePositions: false,
        positions: [],
      }),
    ).toEqual([]);
  });

  it('참가 확정자 아님·포지션 누락·범위 밖', () => {
    const issues = validateTeamAssignment({
      eligibleUserIds,
      blue: [
        { userId: 'x', position: 'top' },
        { userId: 'a', position: null },
      ],
      orange: [{ userId: 'b', position: 'goalie' }],
      usePositions: true,
      positions: LOL,
    });
    expect(issues.map((i) => i.path)).toEqual(['blue.0.user_id', 'blue.1.position', 'orange.0.position']);
  });

  it('팀 인원 > 포지션 수 → path = 팀', () => {
    const issues = validateTeamAssignment({
      eligibleUserIds: ['a', 'b', 'c'],
      blue: [
        { userId: 'a', position: 'top' },
        { userId: 'b', position: 'mid' },
      ],
      orange: [{ userId: 'c', position: 'top' }],
      usePositions: true,
      positions: ['top'],
    });
    expect(issues.map((i) => i.path)).toEqual(['blue.1.position', 'blue']);
  });

  it('포지션 미사용인데 position 있음', () => {
    const issues = validateTeamAssignment({
      eligibleUserIds,
      blue: [{ userId: 'a', position: 'top' }],
      orange: [{ userId: 'b', position: null }],
      usePositions: false,
      positions: LOL,
    });
    expect(issues.map((i) => i.path)).toEqual(['blue.0.position']);
  });
});

describe('validatePlacementUsers', () => {
  it('비참가자만 이슈', () => {
    expect(
      validatePlacementUsers({ eligibleUserIds: ['a', 'b'], placements: [{ userId: 'a' }, { userId: 'z' }, { userId: 'b' }] }),
    ).toEqual([{ path: 'placements.1.user_id', message: expect.any(String) }]);
    expect(validatePlacementUsers({ eligibleUserIds: [], placements: [] })).toEqual([]);
  });
});
