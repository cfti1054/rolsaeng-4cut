import type { ScrimResultRevertBlock, ScrimTeam } from '@gcd/shared';
import { DAY_MS } from './config';
import { isPlacementWin } from './rating';
import { assertValidDate } from './time';

// =============================================================================
// S6 승인 되돌리기(계약 S6 6절, D242–D248). I/O 없음, 시각은 인자. 결과 이의 제기(disputeBlock)는 제거됨(D281)
// =============================================================================

export type RatingOutcome = 'win' | 'loss';
export type RevertHistoryRow = { id: string; userId: string; eloBefore: number; eloAfter: number; createdAt: Date };
export type RevertRatingRow = { userId: string; elo: number; wins: number; losses: number };

function assertWindowDays(v: number, name: string): void {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new RangeError(`${name}: 0 이상의 유한한 숫자여야 함 (${v})`);
  }
}

/**
 * 승인 때의 승패를 다시 구한다(D245).
 * - 팀: teamByUser.get(u) === winnerTeam이면 win, 아니면 loss. 팀이 null·없음인 rated user가 있으면 null.
 * - 개인: placements 중 ratedUserIds만(같은 user가 여러 번이면 첫 항목) placement ASC(같으면 입력 순서)로 1..M 재순위
 *   → isPlacementWin(rank, M). ratedUserIds 중 placements에 없는 사람이 있거나 placement가 유한한 숫자가 아니면 null.
 * - winnerTeam과 placements가 둘 다 null이거나 둘 다 값 → null. ratedUserIds 중복 → null.
 * 승인 때 selectRatedParticipants + computeTeamEloUpdates / computePlacementEloUpdates의 outcome과 같다.
 */
export function inferRevertOutcomes(input: {
  ratedUserIds: readonly string[];
  winnerTeam: ScrimTeam | null;
  teamByUser: ReadonlyMap<string, ScrimTeam | null>;
  placements: readonly { userId: string; placement: number }[] | null;
}): Map<string, RatingOutcome> | null {
  const { ratedUserIds, winnerTeam, teamByUser, placements } = input;
  const rated = new Set(ratedUserIds);
  if (rated.size !== ratedUserIds.length) return null;
  const hasWinner = winnerTeam != null;
  const hasPlacements = placements != null;
  if (hasWinner === hasPlacements) return null;

  const out = new Map<string, RatingOutcome>();
  if (hasWinner) {
    for (const u of ratedUserIds) {
      const team = teamByUser.get(u);
      if (team == null) return null;
      out.set(u, team === winnerTeam ? 'win' : 'loss');
    }
    return out;
  }

  const used = new Set<string>();
  const kept: { userId: string; placement: number; idx: number }[] = [];
  placements!.forEach((p, idx) => {
    if (!rated.has(p.userId) || used.has(p.userId)) return;
    used.add(p.userId);
    kept.push({ userId: p.userId, placement: p.placement, idx });
  });
  if (kept.length !== rated.size) return null;
  if (kept.some((p) => typeof p.placement !== 'number' || !Number.isFinite(p.placement))) return null;
  kept.sort((a, b) => a.placement - b.placement || a.idx - b.idx);
  const m = kept.length;
  kept.forEach((p, i) => out.set(p.userId, isPlacementWin(i + 1, m) ? 'win' : 'loss'));
  return out;
}

/**
 * 되돌리기를 막는 이유(6-2). 우선순위 self_submitted → window_passed → season_closed → later_games. 없으면 null.
 * window_passed: now ≥ approvedAt + windowDays일(24시간 단위). rating_mismatch는 여기서 판정하지 않는다(planRatingRevert).
 * 승인자 본인(actorId = 승인자)은 막지 않는다 — 제출자만 본다.
 */
export function revertBlockReason(input: {
  approvedAt: Date;
  now: Date;
  windowDays: number;
  submittedById: string;
  actorId: string;
  seasonClosed: boolean;
  laterGameUserIds: readonly string[];
}): Exclude<ScrimResultRevertBlock, 'rating_mismatch'> | null {
  const { approvedAt, now, windowDays, submittedById, actorId, seasonClosed, laterGameUserIds } = input;
  assertValidDate(approvedAt, 'approvedAt');
  assertValidDate(now, 'now');
  assertWindowDays(windowDays, 'windowDays');
  if (submittedById === actorId) return 'self_submitted';
  if (now.getTime() >= approvedAt.getTime() + windowDays * DAY_MS) return 'window_passed';
  if (seasonClosed) return 'season_closed';
  if (laterGameUserIds.length > 0) return 'later_games';
  return null;
}

/**
 * ratings 역반영 계획(6-3 7번). 각 이력 user: ratings 행 있음(같은 user 행이 2개 이상이면 실패) && elo === eloAfter
 * && outcome 있음 → elo = eloBefore, win이면 wins − 1, loss면 losses − 1(음수가 되면 실패).
 * 하나라도 실패 → { ok: false, reason: 'rating_mismatch', userIds(실패 user, history 입력 순서, 중복 없이) }.
 * 이력 user 중복도 그 user 실패. 성공 updates는 history 입력 순서. 이력이 비면 ok + []. 입력을 바꾸지 않는다.
 */
export function planRatingRevert(input: {
  history: readonly RevertHistoryRow[];
  ratings: readonly RevertRatingRow[];
  outcomes: ReadonlyMap<string, RatingOutcome>;
}):
  | { ok: true; updates: { userId: string; elo: number; wins: number; losses: number }[] }
  | { ok: false; reason: 'rating_mismatch'; userIds: string[] } {
  const { history, ratings, outcomes } = input;

  const ratingByUser = new Map<string, RevertRatingRow>();
  const duplicateRating = new Set<string>();
  for (const r of ratings) {
    if (ratingByUser.has(r.userId)) duplicateRating.add(r.userId);
    else ratingByUser.set(r.userId, r);
  }
  const historyCount = new Map<string, number>();
  for (const h of history) historyCount.set(h.userId, (historyCount.get(h.userId) ?? 0) + 1);

  const failed: string[] = [];
  const failedSet = new Set<string>();
  const fail = (u: string) => {
    if (!failedSet.has(u)) {
      failedSet.add(u);
      failed.push(u);
    }
  };
  const updates: { userId: string; elo: number; wins: number; losses: number }[] = [];

  for (const h of history) {
    const u = h.userId;
    const rating = ratingByUser.get(u);
    const outcome = outcomes.get(u);
    if ((historyCount.get(u) ?? 0) > 1 || duplicateRating.has(u) || rating === undefined || outcome === undefined) {
      fail(u);
      continue;
    }
    if (rating.elo !== h.eloAfter) {
      fail(u);
      continue;
    }
    const wins = outcome === 'win' ? rating.wins - 1 : rating.wins;
    const losses = outcome === 'loss' ? rating.losses - 1 : rating.losses;
    if (wins < 0 || losses < 0) {
      fail(u);
      continue;
    }
    updates.push({ userId: u, elo: h.eloBefore, wins, losses });
  }

  if (failed.length > 0) return { ok: false, reason: 'rating_mismatch', userIds: failed };
  return { ok: true, updates };
}
