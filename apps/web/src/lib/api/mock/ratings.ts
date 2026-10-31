import {
  balanceTeams,
  buildEloRanking,
  computePlacementEloUpdates,
  computeSkill,
  computeTeamEloUpdates,
  computeWinRate,
  evaluateTeams,
  isPlacementWin,
  latestStartedSeason,
  planAutoSeason,
  previewTeamElo,
  resolveSeasonAt,
  roundHalfAwayFromZero,
  selectRatedParticipants,
  tierSeedRating,
  type BalancePlayer,
  type EloPolicy,
  type SeasonLike,
  type TeamPlan,
  type TeamsEvaluation,
} from '@gcd/core';
import {
  BALANCE_FULL_WEIGHT_GAMES,
  GameCode,
  IsoDateTime,
  PROFILE_RECENT_SCRIMS_LIMIT,
  RANKING_ELO_MIN_GAMES_DEFAULT,
  RATING_HISTORY_POINTS_MAX,
  SCRIM_ELO_K_BASE_DEFAULT,
  SCRIM_ELO_K_NEW_DEFAULT,
  SCRIM_ELO_LOSS_RATIO_DEFAULT,
  SCRIM_ELO_NEW_PLAYER_GAMES_DEFAULT,
  SEASON_AUTO_LENGTH_MONTHS_DEFAULT,
  ScrimPlayerStatus,
  ScrimResultStatus,
  ScrimTeam,
  Uuid,
  type BalanceOptionSide,
  type BalanceScrimResponse,
  type GetUserRatingHistoryResponse,
  type ListSeasonsResponse,
  type ProfileRecentScrim,
  type ProfileScrim,
  type RankTier,
  type RatingPolicyView,
  type ScrimResultView,
  type ScrimTeamSide,
  type ScrimTeamsView,
  type ScrimUserRef,
  type SeasonRef,
} from '@gcd/shared';
import { z } from 'zod';

/**
 * [목] S3 결과·레이팅·시즌 저장소와 계산(계약 S3 4–6절). 계산은 모두 @gcd/core를 import한다(공식 복사본 없음).
 * K 값·시즌 길이는 shared `*_DEFAULT`(목 전용 — 화면 코드는 쓰지 않는다, D124).
 */

const iso = (t: number) => new Date(t).toISOString();

export const MockResult = z.object({
  id: Uuid,
  scrim_id: Uuid,
  status: ScrimResultStatus,
  winner_team: ScrimTeam.nullable(),
  placements: z.array(z.object({ user_id: Uuid, placement: z.number().int().min(1) })).nullable(),
  submitted_by: Uuid,
  created_at: IsoDateTime,
  approved_by: Uuid.nullable(),
  approved_at: IsoDateTime.nullable(),
  rejected_by: Uuid.nullable(),
  rejected_at: IsoDateTime.nullable(),
  reject_reason: z.string().nullable(),
});
export type MockResult = z.infer<typeof MockResult>;

export const MockSeason = z.object({ id: Uuid, name: z.string(), starts_at: IsoDateTime, ends_at: IsoDateTime });
export type MockSeason = z.infer<typeof MockSeason>;

export const MockRating = z.object({
  user_id: Uuid,
  game: GameCode,
  season_id: Uuid,
  elo: z.number().int(),
  wins: z.number().int(),
  losses: z.number().int(),
});
export type MockRating = z.infer<typeof MockRating>;

export const MockHistory = z.object({
  id: Uuid,
  user_id: Uuid,
  game: GameCode,
  season_id: Uuid,
  scrim_id: Uuid,
  result_id: Uuid,
  elo_before: z.number().int(),
  elo_after: z.number().int(),
  delta: z.number().int(),
  k_factor: z.number().int(),
  /** 승패(D105). 패배 0점이나 승리로 세는 음수 변동이 있어 delta 부호로 알 수 없다 */
  outcome: z.enum(['win', 'loss']),
  created_at: IsoDateTime,
});
export type MockHistory = z.infer<typeof MockHistory>;

/** MockS2State에 붙는 S3 저장소 */
export const MockS3Fields = {
  results: z.array(MockResult).default([]),
  seasons: z.array(MockSeason).default([]),
  ratings: z.array(MockRating).default([]),
  history: z.array(MockHistory).default([]),
};
export interface S3Data {
  results: MockResult[];
  seasons: MockSeason[];
  ratings: MockRating[];
  history: MockHistory[];
}

/** 목 env: K 값(SCRIM_ELO_*), 시즌 길이 */
export interface MockRatingOptions {
  policy?: EloPolicy;
  seasonLengthMonths?: number;
}
export function mockEloPolicy(o?: MockRatingOptions): EloPolicy {
  return (
    o?.policy ?? {
      kBase: SCRIM_ELO_K_BASE_DEFAULT,
      kNew: SCRIM_ELO_K_NEW_DEFAULT,
      newPlayerGames: SCRIM_ELO_NEW_PLAYER_GAMES_DEFAULT,
      lossRatio: SCRIM_ELO_LOSS_RATIO_DEFAULT,
    }
  );
}
export function ratingPolicyView(policy: EloPolicy): RatingPolicyView {
  return { k_base: policy.kBase, k_new: policy.kNew, new_player_games: policy.newPlayerGames, loss_ratio: policy.lossRatio, full_weight_games: BALANCE_FULL_WEIGHT_GAMES };
}

// -----------------------------------------------------------------------------
// 티어 시드(D103 흉내): 목 멤버별 고정 티어. 나(로그인 사용자)는 에메랄드
// -----------------------------------------------------------------------------

const MOCK_TIER_BY_NICKNAME: Readonly<Record<string, RankTier>> = {
  미드고정: 'DIAMOND',
  정글차이: 'EMERALD',
  원딜장인: 'PLATINUM',
  서폿요정: 'GOLD',
  한타각: 'EMERALD',
  바론스틸: 'GOLD',
  별빛미드: 'PLATINUM',
  무한점멸: 'DIAMOND',
  와드지기: 'SILVER',
  칼바람러: 'UNRANKED',
  용용이: 'BRONZE',
  체스왕: 'MASTER',
};

/** lol·tft만 티어 큐가 있다(steam 등은 1000) */
export function tierSeedOf(game: GameCode, user: ScrimUserRef | undefined, isMe: boolean): number {
  if (game === 'steam') return tierSeedRating(null);
  if (isMe) return tierSeedRating('EMERALD');
  return tierSeedRating(user ? (MOCK_TIER_BY_NICKNAME[user.nickname] ?? null) : null);
}

// -----------------------------------------------------------------------------
// 조회 헬퍼
// -----------------------------------------------------------------------------

const seasonLikes = (st: S3Data): (SeasonLike & { row: MockSeason })[] =>
  st.seasons.map((s) => ({ id: s.id, startsAt: new Date(s.starts_at), endsAt: new Date(s.ends_at), row: s }));

export function currentSeason(st: S3Data, now: number): MockSeason | null {
  return resolveSeasonAt(seasonLikes(st), new Date(now))?.row ?? null;
}

export const seasonRef = (s: MockSeason): SeasonRef => ({ id: s.id, name: s.name, starts_at: s.starts_at, ends_at: s.ends_at });

export function gamesPlayed(st: S3Data, userId: string, game: GameCode): number {
  return st.history.filter((h) => h.user_id === userId && h.game === game).length;
}

export interface SkillInfo {
  skill: number;
  rating: number;
  games: number;
  isNew: boolean;
}

/** 실력값 입력 모으기(계약 5-2 4번): 현재 시즌 elo, (user, game) 이력 수, 티어 시드 */
export function skillInfo(st: S3Data, input: { userId: string; game: GameCode; tierSeed: number; now: number; policy: EloPolicy }): SkillInfo {
  const season = currentSeason(st, input.now);
  const row = season ? st.ratings.find((r) => r.user_id === input.userId && r.game === input.game && r.season_id === season.id) : undefined;
  const seasonElo = row?.elo ?? null;
  const games = gamesPlayed(st, input.userId, input.game);
  return {
    skill: computeSkill({ seasonElo, gamesPlayed: games, tierSeed: input.tierSeed }),
    rating: seasonElo ?? input.tierSeed,
    games,
    isNew: games < input.policy.newPlayerGames,
  };
}

/** ELO 순위표(core buildEloRanking). 서버 ranking_caches 값을 대신한다. 최소 경기 수는 목 env(목 전용 기본값) */
export function mockEloStandings(st: S3Data, game: GameCode, seasonId: string, minGames: number = RANKING_ELO_MIN_GAMES_DEFAULT) {
  const rows = st.ratings.filter((r) => r.game === game && r.season_id === seasonId).map((r) => ({ ...r, userId: r.user_id }));
  return buildEloRanking({ rows, minGames });
}

const prob3 = (p: number) => Math.round(p * 1000) / 1000;

function sideView(plan: TeamPlan, preview: { win: number; lose: number } | null): ScrimTeamSide {
  return {
    size: plan.members.length,
    skill_sum: plan.skillSum,
    skill_avg: roundHalfAwayFromZero(plan.skillAvg),
    rating_avg: roundHalfAwayFromZero(plan.ratingAvg),
    position_cost: plan.positionCost,
    elo_preview: preview,
  };
}

function previews(e: TeamsEvaluation, rated: boolean, policy: EloPolicy) {
  if (!rated) return { blue: null, orange: null };
  return previewTeamElo({ blueAvg: e.blue.ratingAvg, orangeAvg: e.orange.ratingAvg, k: policy.kBase, lossRatio: policy.lossRatio });
}

export interface TeamPlayerInput extends BalancePlayer {
  position: string | null;
  team: ScrimTeam | null;
}

/** 상세 balance(저장된 팀 요약). 한 팀이라도 joined 배정자가 없으면 null */
export function teamsView(input: {
  joined: readonly TeamPlayerInput[];
  usePositions: boolean;
  rated: boolean;
  policy: EloPolicy;
}): ScrimTeamsView | null {
  const blue = input.joined.filter((p) => p.team === 'blue');
  const orange = input.joined.filter((p) => p.team === 'orange');
  if (blue.length === 0 || orange.length === 0) return null;
  const e = evaluateTeams({ blue, orange, usePositions: input.usePositions });
  const pv = previews(e, input.rated, input.policy);
  return {
    blue: sideView(e.blue, pv.blue),
    orange: sideView(e.orange, pv.orange),
    blue_win_probability: prob3(e.blueWinProbability),
    power_diff: roundHalfAwayFromZero(e.powerDiff),
    position_cost: e.positionCost,
    unassigned_user_ids: input.joined.filter((p) => p.team === null).map((p) => p.userId),
  };
}

/** POST /balance 응답. RangeError(한 팀 > 포지션 수 등)는 호출한 쪽이 SCRIM_BALANCE_UNAVAILABLE로 바꾼다 */
export function balanceResponse(input: {
  players: readonly (BalancePlayer & { user: ScrimUserRef; isNew: boolean })[];
  usePositions: boolean;
  positions: readonly string[];
  rated: boolean;
  policy: EloPolicy;
}): BalanceScrimResponse {
  const { options, partitionsEvaluated } = balanceTeams({ players: input.players, usePositions: input.usePositions, positions: input.positions });
  const byId = new Map(input.players.map((p) => [p.userId, p]));
  const side = (plan: TeamPlan, preview: { win: number; lose: number } | null): BalanceOptionSide => ({
    ...sideView(plan, preview),
    members: plan.members.map((m) => {
      const p = byId.get(m.userId)!;
      return { user: p.user, position: m.position, preference: m.preference, skill: p.skill, rating: roundHalfAwayFromZero(p.rating), is_new: p.isNew };
    }),
  });
  return {
    options: options.map((o, i) => {
      const pv = previews(o, input.rated, input.policy);
      return {
        rank: i + 1,
        blue: side(o.blue, pv.blue),
        orange: side(o.orange, pv.orange),
        blue_win_probability: prob3(o.blueWinProbability),
        power_diff: roundHalfAwayFromZero(o.powerDiff),
        position_cost: o.positionCost,
        total_cost: roundHalfAwayFromZero(o.totalCost),
      };
    }),
    player_count: input.players.length,
    partitions_evaluated: partitionsEvaluated,
    used_positions: input.usePositions,
    rating_policy: ratingPolicyView(input.policy),
  };
}

// -----------------------------------------------------------------------------
// 승인(계약 5-5 5–12단계)
// -----------------------------------------------------------------------------

export function applyApproval(
  st: S3Data,
  input: {
    scrimId: string;
    game: GameCode;
    hasTeams: boolean;
    rated: boolean;
    players: readonly { userId: string; status: ScrimPlayerStatus; team: ScrimTeam | null }[];
    result: MockResult;
    now: number;
    approverId: string;
    tierSeed: (userId: string) => number;
    policy: EloPolicy;
    seasonLengthMonths?: number;
    newId: () => string;
  },
): void {
  const at = new Date(input.now);
  const sel = selectRatedParticipants({
    hasTeams: input.hasTeams,
    players: input.players,
    placements: input.result.placements?.map((p) => ({ userId: p.user_id, placement: p.placement })) ?? null,
  });
  if (input.rated && sel.kind !== 'skip') {
    let season = currentSeason(st, input.now);
    if (!season) {
      const plan = planAutoSeason({
        seasons: seasonLikes(st),
        at,
        lengthMonths: input.seasonLengthMonths ?? SEASON_AUTO_LENGTH_MONTHS_DEFAULT,
      });
      season = { id: input.newId(), name: plan.name, starts_at: plan.startsAt.toISOString(), ends_at: plan.endsAt.toISOString() };
      st.seasons.push(season);
    }
    const seasonId = season.id;
    const ratingRow = (userId: string): MockRating => {
      let r = st.ratings.find((x) => x.user_id === userId && x.game === input.game && x.season_id === seasonId);
      if (!r) {
        r = { user_id: userId, game: input.game, season_id: seasonId, elo: input.tierSeed(userId), wins: 0, losses: 0 };
        st.ratings.push(r);
      }
      return r;
    };
    const rated = (userId: string) => ({ userId, elo: ratingRow(userId).elo, gamesPlayed: gamesPlayed(st, userId, input.game) });
    const updates =
      sel.kind === 'teams'
        ? computeTeamEloUpdates({ blue: sel.blue.map(rated), orange: sel.orange.map(rated), winner: input.result.winner_team!, policy: input.policy })
        : computePlacementEloUpdates({ players: sel.ranked.map((r) => ({ ...rated(r.userId), placement: r.placement })), policy: input.policy });
    for (const u of updates) {
      const r = ratingRow(u.userId);
      r.elo = u.eloAfter;
      if (u.outcome === 'win') r.wins += 1;
      else r.losses += 1;
      st.history.push({
        id: input.newId(),
        user_id: u.userId,
        game: input.game,
        season_id: seasonId,
        scrim_id: input.scrimId,
        result_id: input.result.id,
        elo_before: u.eloBefore,
        elo_after: u.eloAfter,
        delta: u.delta,
        k_factor: u.kFactor,
        outcome: u.outcome,
        created_at: iso(input.now),
      });
    }
  }
  Object.assign(input.result, { status: 'approved', approved_by: input.approverId, approved_at: iso(input.now) });
}

// -----------------------------------------------------------------------------
// 직렬화
// -----------------------------------------------------------------------------

/** 가장 최근 결과 행(created_at DESC → 활성(pending·approved) 먼저 → id DESC. backend 변경 요청 2, 리더 수용) */
export function latestResult(st: S3Data, scrimId: string): MockResult | null {
  const active = (r: MockResult) => (r.status === 'pending' || r.status === 'approved' ? 0 : 1);
  const rows = st.results
    .filter((r) => r.scrim_id === scrimId)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || active(a) - active(b) || (a.id < b.id ? 1 : -1));
  return rows[0] ?? null;
}

export function activeResult(st: S3Data, scrimId: string): MockResult | null {
  return st.results.find((r) => r.scrim_id === scrimId && (r.status === 'pending' || r.status === 'approved')) ?? null;
}

export function resultView(
  st: S3Data,
  r: MockResult,
  ctx: { rated: boolean; hasTeams: boolean; userRef: (id: string) => ScrimUserRef | null; teamOf: (userId: string) => ScrimTeam | null },
): ScrimResultView {
  const ref = (id: string | null) => (id ? ctx.userRef(id) : null);
  const history = st.history
    .filter((h) => h.result_id === r.id)
    .sort((a, b) => b.delta - a.delta || (a.user_id < b.user_id ? -1 : 1));
  const status: ScrimResultView['rating_status'] = !ctx.rated
    ? 'not_rated'
    : r.status === 'approved'
      ? history.length > 0
        ? 'applied'
        : 'skipped'
      : 'waiting';
  const ratedIds = new Set(history.map((h) => h.user_id));
  const reRanked = new Map(
    [...(r.placements ?? [])]
      .filter((p) => ratedIds.has(p.user_id))
      .sort((a, b) => a.placement - b.placement)
      .map((p, i) => [p.user_id, i + 1]),
  );
  const season = status === 'applied' ? st.seasons.find((s) => s.id === history[0]!.season_id) : undefined;
  return {
    id: r.id,
    status: r.status,
    winner_team: r.winner_team,
    placements: [...(r.placements ?? [])]
      .sort((a, b) => a.placement - b.placement)
      .flatMap((p) => {
        const user = ctx.userRef(p.user_id);
        return user ? [{ user, placement: p.placement }] : [];
      }),
    submitted_by: ref(r.submitted_by)!,
    submitted_at: r.created_at,
    approved_by: ref(r.approved_by),
    approved_at: r.approved_at,
    rejected_by: ref(r.rejected_by),
    rejected_at: r.rejected_at,
    reject_reason: r.reject_reason,
    rating_status: status,
    season: season ? seasonRef(season) : null,
    rating_changes:
      status === 'applied'
        ? history.flatMap((h) => {
            const user = ctx.userRef(h.user_id);
            if (!user) return [];
            const team = ctx.hasTeams ? ctx.teamOf(h.user_id) : null;
            const placement = ctx.hasTeams ? null : (reRanked.get(h.user_id) ?? null);
            const outcome = ctx.hasTeams
              ? team !== null && team === r.winner_team
                ? 'win'
                : 'loss'
              : placement !== null && isPlacementWin(placement, reRanked.size)
                ? 'win'
                : 'loss';
            return [
              { user, team, placement, outcome, elo_before: h.elo_before, elo_after: h.elo_after, delta: h.delta, k_factor: h.k_factor } as const,
            ];
          })
        : [],
  };
}

/** 프로필 scrim 블록(계약 4-1 ProfileScrim) */
export function profileScrim(
  st: S3Data,
  input: {
    userId: string;
    now: number;
    gameOrder: readonly GameCode[];
    finished: readonly {
      scrimId: string;
      title: string;
      game: GameCode;
      rated: boolean;
      hasTeams: boolean;
      row: { status: ScrimPlayerStatus; team: ScrimTeam | null; position: string | null };
      /** 그 내전 참가 행 전부(현재 status·team) — 개인 순위 승패 판정용(D136) */
      players: readonly { userId: string; status: ScrimPlayerStatus; team: ScrimTeam | null }[];
    }[];
  },
): ProfileScrim {
  const season = currentSeason(st, input.now);
  const ratings = season
    ? st.ratings
        .filter((r) => r.user_id === input.userId && r.season_id === season.id)
        .sort((a, b) => input.gameOrder.indexOf(a.game) - input.gameOrder.indexOf(b.game))
        .map((r) => ({
          game: r.game,
          elo: r.elo,
          wins: r.wins,
          losses: r.losses,
          games: r.wins + r.losses,
          win_rate: computeWinRate(r.wins, r.losses),
          // 캐시 읽기 흉내(D159): 순위권 밖이면 null
          rank: mockEloStandings(st, r.game, season.id).find((e) => e.userId === input.userId)?.rank ?? null,
        }))
    : [];
  const recent: (ProfileRecentScrim & { t: number })[] = [];
  for (const f of input.finished) {
    if (f.row.status !== 'joined' && f.row.status !== 'no_show') continue;
    const r = st.results.find((x) => x.scrim_id === f.scrimId && x.status === 'approved');
    if (!r?.approved_at) continue;
    const mine = r.placements?.find((p) => p.user_id === input.userId);
    const h = st.history.find((x) => x.result_id === r.id && x.user_id === input.userId);
    let outcome: ProfileRecentScrim['outcome'];
    if (f.row.status === 'no_show') outcome = 'no_show';
    else if (f.hasTeams ? f.row.team === null : !mine) outcome = 'unassigned';
    else if (f.hasTeams) outcome = f.row.team === r.winner_team ? 'win' : 'loss';
    else {
      // D136/D138: 레이팅 반영과 같은 기준 — 노쇼·이탈자를 뺀 참가자끼리 다시 매긴 순위로 상위 절반 승.
      // 이력이 있으면 승인 때 반영된 참가자 기준(승인 뒤 노쇼 표시 무시), 없으면(rated=false·skip) 현재 status 기준
      const ratedIds = st.history.filter((x) => x.result_id === r.id).map((x) => x.user_id);
      const sel = selectRatedParticipants({
        hasTeams: false,
        players: ratedIds.length ? ratedIds.map((userId) => ({ userId, status: 'joined' as const, team: null })) : f.players,
        placements: r.placements!.map((p) => ({ userId: p.user_id, placement: p.placement })),
      });
      // 반영 대상 2명 미만(skip)이면 승패를 정할 수 없어 unassigned(D136 경계, backend와 같음)
      const rank = sel.kind === 'placements' ? sel.ranked.find((x) => x.userId === input.userId)?.placement : undefined;
      if (sel.kind !== 'placements' || rank === undefined) outcome = 'unassigned';
      else outcome = isPlacementWin(rank, sel.ranked.length) ? 'win' : 'loss';
    }
    recent.push({
      scrim_id: f.scrimId,
      title: f.title,
      game: f.game,
      finished_at: r.approved_at,
      rated: f.rated,
      team: f.hasTeams ? f.row.team : null,
      position: f.hasTeams ? f.row.position : null,
      placement: mine?.placement ?? null,
      outcome,
      elo_delta: h?.delta ?? null,
      t: Date.parse(r.approved_at),
    });
  }
  recent.sort((a, b) => b.t - a.t);
  return {
    season: season ? seasonRef(season) : null,
    ratings,
    recent: recent.slice(0, PROFILE_RECENT_SCRIMS_LIMIT).map(({ t: _t, ...rest }) => rest),
  };
}

/** GET /users/:id/rating-history. 없는 시즌 id면 null(호출한 쪽이 NOT_FOUND) */
export function ratingHistory(
  st: S3Data,
  input: { userId: string; game: GameCode; seasonId?: string; now: number; scrimTitle: (id: string) => string },
): GetUserRatingHistoryResponse | null {
  let season: MockSeason | null;
  if (input.seasonId) {
    season = st.seasons.find((s) => s.id === input.seasonId) ?? null;
    if (!season) return null;
  } else {
    const likes = seasonLikes(st);
    const at = new Date(input.now);
    season = resolveSeasonAt(likes, at)?.row ?? latestStartedSeason(likes, at)?.row ?? null;
  }
  if (!season) return { game: input.game, season: null, rating: null, points: [], truncated: false };
  const rows = st.history
    .filter((h) => h.user_id === input.userId && h.game === input.game && h.season_id === season.id)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || (a.id < b.id ? 1 : -1));
  const page = rows.slice(0, RATING_HISTORY_POINTS_MAX).reverse();
  const r = st.ratings.find((x) => x.user_id === input.userId && x.game === input.game && x.season_id === season.id);
  return {
    game: input.game,
    season: seasonRef(season),
    rating: r ? { elo: r.elo, wins: r.wins, losses: r.losses, games: r.wins + r.losses, win_rate: computeWinRate(r.wins, r.losses) } : null,
    points: page.map((h) => ({
      scrim_id: h.scrim_id,
      scrim_title: input.scrimTitle(h.scrim_id),
      at: h.created_at,
      elo_before: h.elo_before,
      elo_after: h.elo_after,
      delta: h.delta,
    })),
    truncated: rows.length > RATING_HISTORY_POINTS_MAX,
  };
}

/** GET /seasons: starts_at DESC, id ASC. is_current = resolveSeasonAt가 고른 행만 */
export function seasonsResponse(st: S3Data, now: number): ListSeasonsResponse {
  const cur = currentSeason(st, now);
  return {
    items: [...st.seasons]
      .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at) || (a.id < b.id ? -1 : 1))
      .map((s) => ({ ...seasonRef(s), is_current: s.id === cur?.id })),
    next_cursor: null,
  };
}
