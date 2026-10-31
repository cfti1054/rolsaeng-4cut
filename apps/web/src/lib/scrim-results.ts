import type {
  BalanceScrimResponse,
  PositionPreference,
  ProfileGameRating,
  ProfileRecentScrim,
  RatingHistoryPoint,
  RatingPolicyView,
  SaveScrimTeamsRequestInput,
  ScrimDetail,
  ScrimPlayerView,
  ScrimResultView,
  ScrimTeam,
} from '@gcd/shared';
import { BALANCE_PLAYERS_MIN } from '@gcd/shared';
import { positionLabel } from './games';

/**
 * S3 팀 구성·결과·레이팅 화면 로직(순수 함수, 단위 테스트 대상). 계약 S3 8·9절.
 * 숫자 정책(K, 기준 경기 수)은 서버 응답(rating_policy)만 쓴다 — shared `*_DEFAULT`를 쓰지 않는다(D101·D124).
 */

const MINUS = '−';

/** `+16` / `−15`(U+2212) / `0` */
export function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `${MINUS}${Math.abs(n)}`;
  return '0';
}

/** 0.574 → `57.4%`(소수 첫째 자리) */
export function percent1(p: number): string {
  return `${(Math.round(p * 1000) / 10).toFixed(1)}%`;
}

export const TEAM_LABEL: Record<ScrimTeam, { tag: string; ko: string }> = {
  blue: { tag: 'BLUE', ko: '블루팀' },
  orange: { tag: 'RED', ko: '레드팀' },
};

export const PREFERENCE_LABEL: Record<PositionPreference, string> = {
  first: '1지망',
  second: '2지망',
  other: '그 외',
};

// -----------------------------------------------------------------------------
// 밸런스
// -----------------------------------------------------------------------------

/** 「126가지 팀 구성 × 포지션 배정 중 비용이 가장 낮은 3개 안」 */
export function balanceSubtitle(r: Pick<BalanceScrimResponse, 'partitions_evaluated' | 'used_positions' | 'options'>): string {
  return `${r.partitions_evaluated}가지 팀 구성${r.used_positions ? ' × 포지션 배정' : ''} 중 비용이 가장 낮은 ${r.options.length}개 안`;
}

/** 실력값 설명. 정책 값(밸런스 응답)이 없으면 숫자 없는 문구(D124) */
export function skillFormulaText(policy: RatingPolicyView | null | undefined): string {
  if (!policy) return '실력값은 티어를 중심으로 이번 시즌 내전 ELO를 조금 섞어 계산해요.';
  const n = Math.round(policy.elo_weight_max * 100);
  const base = `실력값 = w × 내전 ELO + (1 − w) × 티어 환산값. w는 이번 시즌 내전 경기 수에 따라 0에서 ${n}%까지 늘어요(${policy.full_weight_games}경기부터 ${n}%). K = ${policy.k_base}, 신규 멤버 K = ${policy.k_new}.`;
  return policy.loss_ratio === 1 ? base : `${base} 패배 점수는 ${Math.round(policy.loss_ratio * 100)}%만 반영해요.`;
}

/** 팀 카드 바닥 「승리 +12 · 패배 −20」. elo_preview null이면 null(문구 생략) */
export function eloPreviewText(p: { win: number; lose: number } | null): { win: string; lose: string } | null {
  if (!p) return null;
  return { win: signed(p.win), lose: `${MINUS}${Math.abs(p.lose)}` };
}

/** 밸런스 결과가 어떤 명단으로 계산됐는지(명단이 바뀌면 결과를 버린다) */
export function rosterKey(players: readonly Pick<ScrimPlayerView, 'status' | 'user'>[]): string {
  return players
    .filter((p) => p.status === 'joined')
    .map((p) => p.user.id)
    .sort()
    .join(',');
}

// -----------------------------------------------------------------------------
// 팀 직접 수정
// -----------------------------------------------------------------------------

export type TeamDraft = Record<string, { team: ScrimTeam | null; position: string | null }>;

/** 편집기 시작값: 저장된 팀(joined만) */
export function draftFromPlayers(players: readonly ScrimPlayerView[]): TeamDraft {
  const d: TeamDraft = {};
  for (const p of players) if (p.status === 'joined') d[p.user.id] = { team: p.team, position: p.team ? p.position : null };
  return d;
}

/**
 * 편집 내용 → PUT /teams 본문 + 문제 목록(화면 사전 검사. 서버가 다시 검사한다).
 * 각 팀 1명 이상, 포지션 사용 내전은 팀원마다 포지션 필수·팀 안 중복 금지·인원 ≤ 포지션 수.
 */
export function buildTeamsRequest(
  players: readonly ScrimPlayerView[],
  draft: TeamDraft,
  usePositions: boolean,
  positions: readonly string[],
): { body: SaveScrimTeamsRequestInput | null; issues: string[] } {
  const issues: string[] = [];
  const body: { blue: { user_id: string; position: string | null }[]; orange: { user_id: string; position: string | null }[] } = {
    blue: [],
    orange: [],
  };
  for (const p of players) {
    if (p.status !== 'joined') continue;
    const d = draft[p.user.id];
    if (!d?.team) continue;
    body[d.team].push({ user_id: p.user.id, position: usePositions ? d.position : null });
  }
  for (const team of ['blue', 'orange'] as const) {
    const label = TEAM_LABEL[team].ko;
    if (body[team].length === 0) issues.push(`${label}에 1명 이상 넣어 주세요.`);
    if (!usePositions) continue;
    if (body[team].length > positions.length) issues.push(`${label}은 최대 ${positions.length}명이에요.`);
    if (body[team].some((s) => !s.position)) issues.push(`${label} 팀원의 포지션을 모두 골라 주세요.`);
    const used = body[team].map((s) => s.position).filter((x): x is string => !!x);
    const dup = used.find((x, i) => used.indexOf(x) !== i);
    if (dup) issues.push(`${label}에 ${positionLabel(dup)} 포지션이 두 명이에요.`);
  }
  return { body: issues.length ? null : body, issues };
}

// -----------------------------------------------------------------------------
// 결과
// -----------------------------------------------------------------------------

export type PlacementDraft = Record<string, number | null>;

/**
 * 순위 입력 검사: 순위를 준 사람이 2명 이상, 1위부터 빈 순위·동순위 없이(1..m).
 * 통과하면 placements(순위 오름차순) 반환.
 */
export function buildPlacements(draft: PlacementDraft): { placements: { user_id: string; placement: number }[] | null; issue: string | null } {
  const ranked = Object.entries(draft)
    .filter((e): e is [string, number] => e[1] !== null)
    .map(([user_id, placement]) => ({ user_id, placement }))
    .sort((a, b) => a.placement - b.placement);
  if (ranked.length < BALANCE_PLAYERS_MIN) return { placements: null, issue: `${BALANCE_PLAYERS_MIN}명 이상 순위를 매겨 주세요.` };
  const ranks = ranked.map((r) => r.placement);
  if (new Set(ranks).size !== ranks.length) return { placements: null, issue: '같은 순위를 두 명에게 줄 수 없어요.' };
  if (!ranks.every((r, i) => r === i + 1)) return { placements: null, issue: '1위부터 빈 순위 없이 매겨 주세요.' };
  return { placements: ranked, issue: null };
}

/** RESULT 영역 상태(계약 S3 9절 표) */
export type ResultPanelState =
  | { kind: 'before' }
  | { kind: 'cancelled' }
  | { kind: 'input'; rejected: ScrimResultView | null }
  | { kind: 'need_teams'; rejected: ScrimResultView | null }
  | { kind: 'waiting'; rejected: ScrimResultView | null }
  /** 개인 순위 게임에서 joined 참가자가 2명 미만(방장·운영진에게만) */
  | { kind: 'too_few'; rejected: ScrimResultView | null }
  | { kind: 'pending'; result: ScrimResultView }
  | { kind: 'approved'; result: ScrimResultView }
  | { kind: 'no_result' };

export function resultPanelState(
  s: Pick<ScrimDetail, 'status' | 'result' | 'viewer' | 'balance' | 'game' | 'players'>,
  opts: { isAdmin?: boolean } = {},
): ResultPanelState {
  if (s.status === 'cancelled') return { kind: 'cancelled' };
  if (s.status === 'recruiting' || s.status === 'full') return { kind: 'before' };
  const r = s.result;
  if (r?.status === 'approved') return { kind: 'approved', result: r };
  if (s.status === 'finished') return { kind: 'no_result' };
  if (r?.status === 'pending') return { kind: 'pending', result: r };
  const rejected = r?.status === 'rejected' ? r : null;
  if (s.viewer.can_submit_result) return { kind: 'input', rejected };
  const manager = s.viewer.is_host || s.viewer.can_edit_teams || opts.isAdmin === true;
  if (s.game.has_teams && s.balance === null && manager) return { kind: 'need_teams', rejected };
  const joined = s.players.filter((p) => p.status === 'joined').length;
  if (!s.game.has_teams && manager && joined < BALANCE_PLAYERS_MIN) return { kind: 'too_few', rejected };
  return { kind: 'waiting', rejected };
}

/** 부제 「방장 입력 → 운영진 승인 → 레이팅 반영」(rated=false면 마지막 단계 없음) */
export function resultFlowText(rated: boolean): string {
  return rated ? '방장 입력 → 운영진 승인 → 레이팅 반영' : '방장 입력 → 운영진 승인';
}

/** pending 문구(목업 「블루팀 승리로 제출했어요. 운영진이 승인하면 레이팅이 반영됩니다.」) */
export function pendingResultText(r: Pick<ScrimResultView, 'winner_team'>, rated: boolean): string {
  const head = r.winner_team ? `${TEAM_LABEL[r.winner_team].ko} 승리로 제출했어요.` : '순위를 제출했어요.';
  return `${head} ${rated ? '운영진이 승인하면 레이팅이 반영됩니다.' : '운영진이 승인하면 결과가 확정돼요.'}`;
}

/** 승인 후 레이팅 상태 안내(applied는 표를 그리므로 null) */
export function ratingStatusText(status: ScrimResultView['rating_status']): string | null {
  switch (status) {
    case 'skipped':
      return '반영할 참가자가 부족해 레이팅은 바뀌지 않았어요';
    case 'not_rated':
      return 'ELO 미반영 내전이라 레이팅은 바뀌지 않았어요';
    default:
      return null;
  }
}

// -----------------------------------------------------------------------------
// 프로필
// -----------------------------------------------------------------------------

/** 대표 게임 = games가 가장 많은 행(같으면 목록 순서) */
export function primaryRating(ratings: readonly ProfileGameRating[]): ProfileGameRating | null {
  let best: ProfileGameRating | null = null;
  for (const r of ratings) if (!best || r.games > best.games) best = r;
  return best;
}

/** 「17승 11패 · 승률 61%」, 경기 없으면 「아직 경기 없음」 */
export function ratingRecordText(r: Pick<ProfileGameRating, 'wins' | 'losses' | 'win_rate'>): string {
  if (r.win_rate === null) return '아직 경기 없음';
  return `${r.wins}승 ${r.losses}패 · 승률 ${Math.round(r.win_rate * 100)}%`;
}

/** 그래프 데이터: 첫 점 = points[0].elo_before, 이후 elo_after. up = 직전보다 올랐는가(첫 점 null) */
export function ratingChartData(points: readonly RatingHistoryPoint[]): { i: number; elo: number; up: boolean | null; title: string | null; at: string | null }[] {
  if (points.length === 0) return [];
  return [
    { i: 0, elo: points[0]!.elo_before, up: null, title: null, at: null },
    ...points.map((p, k) => ({ i: k + 1, elo: p.elo_after, up: p.delta >= 0, title: p.scrim_title, at: p.at })),
  ];
}

/** 최근 내전 칩 */
export const RECENT_OUTCOME_LABEL: Record<ProfileRecentScrim['outcome'], string> = {
  win: 'WIN',
  loss: 'LOSS',
  no_show: '노쇼',
  unassigned: '미배정',
};

/** 최근 내전 보조 줄 끝 「탑」 또는 「3위」. 없으면 null */
export function recentScrimRole(r: Pick<ProfileRecentScrim, 'position' | 'placement'>): string | null {
  if (r.placement !== null) return `${r.placement}위`;
  if (r.position) return positionLabel(r.position);
  return null;
}

/** 「참가자가 2명 이상이어야 결과를 입력할 수 있어요」(개인 순위 게임, joined 부족) */
export function tooFewPlayersText(): string {
  return `참가자가 ${BALANCE_PLAYERS_MIN}명 이상이어야 결과를 입력할 수 있어요`;
}

/** 순위 입력 draft를 현재 joined 명단으로 정리한다(재조회로 노쇼·이탈한 사람 제거, 새로 들어온 사람은 순위 없음) */
export function pruneDraft(draft: PlacementDraft, joinedIds: readonly string[]): PlacementDraft {
  return Object.fromEntries(joinedIds.map((id) => [id, draft[id] ?? null]));
}

/**
 * VALIDATION_FAILED details를 입력 행에 나눠 붙인다(계약 S3 9절 「해당 입력 아래」).
 * resolve(path)가 행 키(user id)를 돌려주면 그 행에, null이면 rest(패널 하단)로.
 */
export function splitValidationDetails(
  details: readonly { path: string; message: string }[] | undefined,
  resolve: (path: string) => string | null,
): { byKey: Record<string, string[]>; rest: string[] } {
  const byKey: Record<string, string[]> = {};
  const rest: string[] = [];
  for (const d of details ?? []) {
    const key = resolve(d.path);
    if (key) (byKey[key] ??= []).push(d.message);
    else rest.push(d.message);
  }
  return { byKey, rest };
}

/** 팀 저장 path(`blue.2.position`, `orange.0.user_id`) → 그 슬롯의 user id */
export function teamPathUser(body: SaveScrimTeamsRequestInput | undefined, path: string): string | null {
  const m = /^(blue|orange)\.(\d+)\.(user_id|position)$/.exec(path);
  if (!m || !body) return null;
  return body[m[1] as ScrimTeam][Number(m[2])]?.user_id ?? null;
}

/** 순위 제출 path(`placements.1.user_id`) → 그 항목의 user id */
export function placementPathUser(body: { placements: readonly { user_id: string }[] } | undefined, path: string): string | null {
  const m = /^placements\.(\d+)\.(user_id|placement)$/.exec(path);
  if (!m || !body) return null;
  return body.placements[Number(m[1])]?.user_id ?? null;
}
