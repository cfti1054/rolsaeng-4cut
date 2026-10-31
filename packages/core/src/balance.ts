import {
  BALANCE_ELO_WEIGHT_MAX,
  BALANCE_FULL_WEIGHT_GAMES,
  BALANCE_OPTIONS_MAX,
  BALANCE_PLAYERS_MAX,
  BALANCE_PLAYERS_MIN,
  RATING_START_ELO,
  type PositionPreference,
} from '@gcd/shared';
import { BALANCE_POSITION_COST_WEIGHT, POSITION_PREFERENCE_COST } from './config';
import { expectedScore, meanRating, roundHalfAwayFromZero } from './rating';

// =============================================================================
// S3 팀 자동 밸런스(문서 7-2, 계약 S3 7-4, D107·D108). I/O 없음, 결정적(같은 입력 → 같은 출력).
// core 결과는 반올림 전 값이다. 표시용 반올림은 backend 직렬화에서 한다.
// S4 20절(D187): 실력값은 티어 환산값 중심, 내전 ELO 비중은 현재 시즌 경기 수에 따라 최대 BALANCE_ELO_WEIGHT_MAX.
// =============================================================================

export type BalancePlayer = {
  userId: string;
  /** 실력값(computeSkill, 정수) */
  skill: number;
  /** 현재 시즌 ELO(행이 없으면 RATING_START_ELO). elo_preview·rating_avg용 */
  rating: number;
  preferredPositions: readonly string[];
};
export type TeamMemberPlan = { userId: string; position: string | null; preference: PositionPreference | null };
export type TeamPlan = {
  members: TeamMemberPlan[];
  skillSum: number;
  skillAvg: number;
  ratingAvg: number;
  positionCost: number;
};
export type TeamsEvaluation = {
  blue: TeamPlan;
  orange: TeamPlan;
  powerDiff: number;
  positionCost: number;
  blueWinProbability: number;
};
export type BalanceResult = TeamsEvaluation & { totalCost: number };
export type ValidationIssue = { path: string; message: string };

const EPS = 1e-9;

/** a와 b를 |a − b| ≤ 1e-9면 같다고 보고 비교 */
function cmpNum(a: number, b: number): number {
  if (Math.abs(a - b) <= EPS) return 0;
  return a < b ? -1 : 1;
}

/** 문자열 코드 단위 비교(로캘 무관, 결정적) */
function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpSeq(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

/**
 * 실력값의 내전 ELO 비중(D187) = BALANCE_ELO_WEIGHT_MAX × min(seasonGames, F) ÷ F, F = BALANCE_FULL_WEIGHT_GAMES.
 * 곱한 뒤 나눠 부동소수 오차를 줄인다(1경기 = 0.02). seasonGames가 0 이상의 정수가 아니면 RangeError.
 */
export function balanceEloWeight(seasonGames: number): number {
  if (!Number.isInteger(seasonGames) || seasonGames < 0) {
    throw new RangeError(`seasonGames: 0 이상의 정수 (${seasonGames})`);
  }
  return (BALANCE_ELO_WEIGHT_MAX * Math.min(seasonGames, BALANCE_FULL_WEIGHT_GAMES)) / BALANCE_FULL_WEIGHT_GAMES;
}

/**
 * 실력값(D187) = round(w × elo + (1 − w) × tierSeed), w = balanceEloWeight(seasonGames),
 * elo = seasonElo ?? RATING_START_ELO. tierSeed는 밸런스 티어 환산값(D189)이다.
 */
export function computeSkill(input: { seasonElo: number | null; seasonGames: number; tierSeed: number }): number {
  const { seasonElo, seasonGames, tierSeed } = input;
  const w = balanceEloWeight(seasonGames);
  const elo = seasonElo ?? RATING_START_ELO;
  return roundHalfAwayFromZero(w * elo + (1 - w) * tierSeed);
}

/** preferred[0] = position → first, preferred[1] → second, 그 외 other */
export function positionPreferenceOf(preferred: readonly string[], position: string): PositionPreference {
  if (preferred[0] === position) return 'first';
  if (preferred[1] === position) return 'second';
  return 'other';
}

function positionCostOf(preferred: readonly string[], position: string): number {
  return POSITION_PREFERENCE_COST[positionPreferenceOf(preferred, position)];
}

/**
 * 팀원 k명에게 서로 다른 포지션을 한 명씩 배정하는 모든 경우(P(|positions|, k)) 중 비용 합 최소.
 * 동점 → members 순서로 본 포지션 index 수열이 사전순 가장 작은 것(사전순 DFS에서 더 작을 때만 갱신).
 * k > |positions| → RangeError. k = 0 → { positions: [], cost: 0 }.
 */
export function bestPositionAssignment(
  members: readonly BalancePlayer[],
  positions: readonly string[],
): { positions: string[]; cost: number } {
  const k = members.length;
  const p = positions.length;
  if (k > p) throw new RangeError(`members(${k})가 positions(${p})보다 많음`);
  if (k === 0) return { positions: [], cost: 0 };

  const costs = members.map((m) => positions.map((pos) => positionCostOf(m.preferredPositions, pos)));
  const used = new Array<boolean>(p).fill(false);
  const cur = new Array<number>(k).fill(0);
  let best: number[] | null = null;
  let bestCost = Infinity;

  const dfs = (i: number, acc: number): void => {
    if (acc >= bestCost) return; // 같은 비용은 사전순으로 먼저 찾은 쪽이 이미 best
    if (i === k) {
      bestCost = acc;
      best = cur.slice();
      return;
    }
    for (let j = 0; j < p; j++) {
      if (used[j]) continue;
      used[j] = true;
      cur[i] = j;
      dfs(i + 1, acc + costs[i]![j]!);
      used[j] = false;
    }
  };
  dfs(0, 0);

  const chosen = best as unknown as number[];
  return { positions: chosen.map((j) => positions[j]!), cost: bestCost };
}

function sortMembersBySkill(
  members: TeamMemberPlan[],
  skillOf: ReadonlyMap<string, number>,
): TeamMemberPlan[] {
  return members.sort((a, b) => skillOf.get(b.userId)! - skillOf.get(a.userId)! || cmpStr(a.userId, b.userId));
}

function buildTeamPlan(
  team: readonly BalancePlayer[],
  usePositions: boolean,
  positions: readonly string[],
): TeamPlan {
  const skillSum = team.reduce((s, p) => s + p.skill, 0);
  const skillAvg = skillSum / team.length;
  const ratingAvg = meanRating(team.map((p) => p.rating));
  if (usePositions) {
    const a = bestPositionAssignment(team, positions);
    const order = new Map(positions.map((pos, i) => [pos, i] as const));
    const members = team
      .map((p, i) => ({
        userId: p.userId,
        position: a.positions[i]!,
        preference: positionPreferenceOf(p.preferredPositions, a.positions[i]!),
      }))
      .sort((x, y) => order.get(x.position)! - order.get(y.position)!);
    return { members, skillSum, skillAvg, ratingAvg, positionCost: a.cost };
  }
  const skillOf = new Map(team.map((p) => [p.userId, p.skill] as const));
  const members = sortMembersBySkill(
    team.map((p) => ({ userId: p.userId, position: null, preference: null })),
    skillOf,
  );
  return { members, skillSum, skillAvg, ratingAvg, positionCost: 0 };
}

function summarize(blue: TeamPlan, orange: TeamPlan, n: number): TeamsEvaluation {
  const powerDiff = (Math.abs(blue.skillAvg - orange.skillAvg) * n) / 2;
  return {
    blue,
    orange,
    powerDiff,
    positionCost: blue.positionCost + orange.positionCost,
    blueWinProbability: expectedScore(blue.skillAvg, orange.skillAvg),
  };
}

/** n개 중 k개 조합(사전순) */
function* combinations(n: number, k: number): Generator<number[]> {
  const idx = Array.from({ length: k }, (_, i) => i);
  if (k > n) return;
  while (true) {
    yield idx.slice();
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]!++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1]! + 1;
  }
}

/**
 * 팀 자동 밸런스(D108). 크기 ⌊n/2⌋ 부분집합을 전수 탐색(짝수는 players[0] 포함만), 블루 = players[0]이 있는 쪽.
 * 총 비용 = 전력 차 + λ × 포지션 비용. 정렬 totalCost → powerDiff → positionCost → 블루 index 수열 사전순.
 * 서로 다른 팀 나누기 상위 maxOptions(기본 3)개. 반올림 전 값.
 */
export function balanceTeams(input: {
  players: readonly BalancePlayer[];
  usePositions: boolean;
  positions: readonly string[];
  maxOptions?: number;
}): { options: BalanceResult[]; partitionsEvaluated: number } {
  const { players, usePositions, positions } = input;
  const maxOptions = input.maxOptions ?? BALANCE_OPTIONS_MAX;
  const n = players.length;
  if (!Number.isInteger(n) || n < BALANCE_PLAYERS_MIN || n > BALANCE_PLAYERS_MAX) {
    throw new RangeError(`players: ${BALANCE_PLAYERS_MIN}–${BALANCE_PLAYERS_MAX}명 (${n})`);
  }
  if (usePositions && Math.ceil(n / 2) > positions.length) {
    throw new RangeError(`한 팀 인원(${Math.ceil(n / 2)})이 포지션 수(${positions.length})보다 많음`);
  }
  if (!Number.isInteger(maxOptions) || maxOptions < 1) {
    throw new RangeError(`maxOptions: 1 이상의 정수 (${maxOptions})`);
  }
  const ids = new Set(players.map((p) => p.userId));
  if (ids.size !== n) throw new RangeError('players: userId 중복');

  const small = Math.floor(n / 2);
  const even = n % 2 === 0;
  // 같은 팀 구성(비트마스크)의 계산은 재사용한다(홀수 인원에서 큰 팀 쪽은 여러 번 나온다)
  const planCache = new Map<number, TeamPlan>();
  const planOf = (idx: readonly number[]): TeamPlan => {
    let mask = 0;
    for (const i of idx) mask |= 1 << i;
    let plan = planCache.get(mask);
    if (!plan) {
      plan = buildTeamPlan(
        idx.map((i) => players[i]!),
        usePositions,
        positions,
      );
      planCache.set(mask, plan);
    }
    return plan;
  };

  type Candidate = BalanceResult & { blueIdx: number[] };
  const candidates: Candidate[] = [];
  let partitionsEvaluated = 0;
  for (const s of combinations(n, small)) {
    if (even && s[0] !== 0) break; // 사전순이라 0을 포함하는 조합이 모두 앞에 온다
    const inS = new Set(s);
    const rest: number[] = [];
    for (let i = 0; i < n; i++) if (!inS.has(i)) rest.push(i);
    const blueIdx = inS.has(0) ? s : rest;
    const orangeIdx = inS.has(0) ? rest : s;
    partitionsEvaluated++;
    const ev = summarize(planOf(blueIdx), planOf(orangeIdx), n);
    candidates.push({
      ...ev,
      totalCost: ev.powerDiff + BALANCE_POSITION_COST_WEIGHT * ev.positionCost,
      blueIdx,
    });
  }

  candidates.sort(
    (a, b) =>
      cmpNum(a.totalCost, b.totalCost) ||
      cmpNum(a.powerDiff, b.powerDiff) ||
      cmpNum(a.positionCost, b.positionCost) ||
      cmpSeq(a.blueIdx, b.blueIdx),
  );

  const options: BalanceResult[] = candidates.slice(0, maxOptions).map((c) => ({
    blue: cloneTeam(c.blue),
    orange: cloneTeam(c.orange),
    powerDiff: c.powerDiff,
    positionCost: c.positionCost,
    blueWinProbability: c.blueWinProbability,
    totalCost: c.totalCost,
  }));
  return { options, partitionsEvaluated };
}

function cloneTeam(t: TeamPlan): TeamPlan {
  return { ...t, members: t.members.map((m) => ({ ...m })) };
}

/**
 * 저장된 팀 요약(상세 balance). 포지션은 주어진 값으로 비용 계산(usePositions && position 있을 때만,
 * 없으면 그 사람 비용 0·preference null). 공식은 balanceTeams와 같다. 한 팀이 비면 RangeError.
 * members는 입력 순서 그대로(포지션 목록 인자가 없어 포지션 순 정렬을 하지 않는다). usePositions=false면 position null.
 */
export function evaluateTeams(input: {
  blue: readonly (BalancePlayer & { position: string | null })[];
  orange: readonly (BalancePlayer & { position: string | null })[];
  usePositions: boolean;
}): TeamsEvaluation {
  const { blue, orange, usePositions } = input;
  if (blue.length === 0 || orange.length === 0) {
    throw new RangeError('blue·orange: 두 팀 모두 1명 이상이어야 함');
  }
  const plan = (team: readonly (BalancePlayer & { position: string | null })[]): TeamPlan => {
    let positionCost = 0;
    const members: TeamMemberPlan[] = team.map((p) => {
      if (usePositions && p.position != null) {
        const preference = positionPreferenceOf(p.preferredPositions, p.position);
        positionCost += POSITION_PREFERENCE_COST[preference];
        return { userId: p.userId, position: p.position, preference };
      }
      return { userId: p.userId, position: usePositions ? p.position : null, preference: null };
    });
    const skillSum = team.reduce((s, p) => s + p.skill, 0);
    return {
      members,
      skillSum,
      skillAvg: skillSum / team.length,
      ratingAvg: meanRating(team.map((p) => p.rating)),
      positionCost,
    };
  };
  return summarize(plan(blue), plan(orange), blue.length + orange.length);
}

/**
 * 팀 저장 서버 검사(계약 5-3 2번). 형식(중복 등)은 shared zod가 먼저 검사한다.
 * - user_id ∉ eligible → `{team}.{i}.user_id`
 * - usePositions: position 없음·positions 밖 → `{team}.{i}.position`, 팀 인원 > positions 수 → `{team}`
 * - !usePositions: position != null → `{team}.{i}.position`
 * 빈 배열 = 통과. 순서: blue → orange, 팀 안에서는 슬롯 순서 → 인원 초과.
 */
export function validateTeamAssignment(input: {
  eligibleUserIds: readonly string[];
  blue: readonly { userId: string; position: string | null }[];
  orange: readonly { userId: string; position: string | null }[];
  usePositions: boolean;
  positions: readonly string[];
}): ValidationIssue[] {
  const { usePositions, positions } = input;
  const eligible = new Set(input.eligibleUserIds);
  const posSet = new Set(positions);
  const issues: ValidationIssue[] = [];
  for (const team of ['blue', 'orange'] as const) {
    const slots = input[team];
    slots.forEach((slot, i) => {
      if (!eligible.has(slot.userId)) {
        issues.push({ path: `${team}.${i}.user_id`, message: '이 내전의 참가 확정자가 아님' });
      }
      if (usePositions) {
        if (slot.position == null) {
          issues.push({ path: `${team}.${i}.position`, message: '포지션을 정해야 함' });
        } else if (!posSet.has(slot.position)) {
          issues.push({ path: `${team}.${i}.position`, message: '이 게임의 포지션이 아님' });
        }
      } else if (slot.position != null) {
        issues.push({ path: `${team}.${i}.position`, message: '포지션을 쓰지 않는 내전' });
      }
    });
    if (usePositions && slots.length > positions.length) {
      issues.push({ path: team, message: `한 팀은 최대 ${positions.length}명(포지션 수)` });
    }
  }
  return issues;
}

/** 개인 순위 제출 서버 검사: user_id ∉ eligible → `placements.{i}.user_id`. 형식은 shared zod가 검사 */
export function validatePlacementUsers(input: {
  eligibleUserIds: readonly string[];
  placements: readonly { userId: string }[];
}): ValidationIssue[] {
  const eligible = new Set(input.eligibleUserIds);
  const issues: ValidationIssue[] = [];
  input.placements.forEach((p, i) => {
    if (!eligible.has(p.userId)) {
      issues.push({ path: `placements.${i}.user_id`, message: '이 내전의 참가 확정자가 아님' });
    }
  });
  return issues;
}
