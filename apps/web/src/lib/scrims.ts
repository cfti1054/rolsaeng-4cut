import type {
  GameCapacityRange,
  GameCode,
  GetMyPositionSuggestionsResponse,
  TftMode,
  NoShowPolicyView,
  OpenPosition,
  ScrimCancelReason,
  ScrimDetail,
  ScrimListStatus,
  ScrimOptions,
  ScrimPolicyView,
  ScrimRestriction,
  ScrimStatus,
  ScrimSummary,
  UpdateScrimRequestInput,
} from '@gcd/shared';
import { SCRIM_MIN_PLAYERS_TO_START, TFT_MODE_LABEL } from '@gcd/shared';
import { positionLabel } from './games';
import { TEAM_LABEL } from './scrim-results';

/**
 * 내전 화면 로직(순수 함수, 단위 테스트 대상). 계약 S2 6·8절.
 * 시각 표시는 항상 KST(Asia/Seoul). 서버 판단(join_closed, viewer.can_*)은 그대로 쓰고 다시 계산하지 않는다(D93).
 */

const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

export const SCRIM_LIST_TABS: readonly { value: ScrimListStatus; label: string }[] = [
  { value: 'open', label: '모집 중' },
  { value: 'playing', label: '진행 중' },
  { value: 'ended', label: '종료' },
];

/** recruiting·full = 모집 중(참가·수정·시작·취소 가능 상태) */
export function isOpenStatus(status: ScrimStatus): boolean {
  return status === 'recruiting' || status === 'full';
}

// -----------------------------------------------------------------------------
// KST 시각
// -----------------------------------------------------------------------------

interface KstParts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  weekday: number;
  /** KST 자정 기준 날짜 번호(같은 날 비교용) */
  dayIndex: number;
}

function kst(t: number): KstParts {
  const s = new Date(t + KST_OFFSET_MS);
  return {
    y: s.getUTCFullYear(),
    m: s.getUTCMonth() + 1,
    d: s.getUTCDate(),
    hh: s.getUTCHours(),
    mm: s.getUTCMinutes(),
    weekday: s.getUTCDay(),
    dayIndex: Math.floor((t + KST_OFFSET_MS) / DAY_MS),
  };
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** `21:00` */
export function kstClock(iso: string): string {
  const k = kst(Date.parse(iso));
  return `${p2(k.hh)}:${p2(k.mm)}`;
}

/**
 * 카드·헤더의 날짜 부분(목업 「오늘」「토요일」).
 * 오늘 / 내일 / 어제 / 6일 안이면 「토요일」 / 그 밖은 「11.05 (수)」
 */
export function scrimDayLabel(iso: string, now: number): string {
  const a = kst(Date.parse(iso));
  const diff = a.dayIndex - kst(now).dayIndex;
  if (diff === 0) return '오늘';
  if (diff === 1) return '내일';
  if (diff === -1) return '어제';
  if (diff > 1 && diff < 7) return `${WEEKDAYS[a.weekday]}요일`;
  return `${p2(a.m)}.${p2(a.d)} (${WEEKDAYS[a.weekday]})`;
}

/** 「오늘 21:00」 */
export function scrimWhen(iso: string, now: number): string {
  return `${scrimDayLabel(iso, now)} ${kstClock(iso)}`;
}

/** 「10.28 (수) 21:00」 — 해제 시각 등 날짜가 꼭 필요한 곳 */
export function kstDateTime(iso: string): string {
  const k = kst(Date.parse(iso));
  return `${p2(k.m)}.${p2(k.d)} (${WEEKDAYS[k.weekday]}) ${p2(k.hh)}:${p2(k.mm)}`;
}

/** 「10.28 21:00」(계약 8절 제한 배너 형식 MM.DD HH:mm) */
export function kstMonthDayTime(iso: string): string {
  const k = kst(Date.parse(iso));
  return `${p2(k.m)}.${p2(k.d)} ${p2(k.hh)}:${p2(k.mm)}`;
}

/** 공유 문구의 상태. 복사한 사람 기준 「참가 중」이 아니라 모집글 상태다 */
function shareStatusLabel(status: ScrimStatus, joinClosed: boolean): string {
  switch (status) {
    case 'recruiting':
      return joinClosed ? '시작 대기' : '모집 중';
    case 'full':
      return joinClosed ? '시작 대기' : '정원 마감';
    case 'playing':
      return '진행 중';
    case 'finished':
      return '종료';
    case 'cancelled':
      return '취소됨';
  }
}

function shareHeading(code: GameCode, tftMode: TftMode | null | undefined, steamApp: string | null): string {
  if (code === 'lol') return '⚔️ LOL 협곡 내전';
  if (code === 'tft') return `♟️ TFT${tftMode ? ` ${TFT_MODE_LABEL[tftMode]}` : ''} 내전`;
  return `🕹️ 스팀 내전${steamApp ? ` · ${steamApp}` : ''}`;
}

/** 메신저 공유용 문구. 카톡·디스코드가 마지막 줄 주소를 링크로 바꾼다 */
export function scrimShareText(
  s: Pick<ScrimDetail, 'title' | 'scheduled_at' | 'capacity' | 'joined_count' | 'status' | 'join_closed'> & {
    game: { code: GameCode };
    steam_app?: ScrimDetail['steam_app'];
    tft_mode?: TftMode | null;
  },
  url: string,
): string {
  const k = kst(Date.parse(s.scheduled_at));
  return [
    shareHeading(s.game.code, s.tft_mode, s.steam_app?.name ?? null),
    s.title,
    '',
    `📅 ${k.m}월 ${k.d}일 (${WEEKDAYS[k.weekday]})`,
    `⏰ ${p2(k.hh)}:${p2(k.mm)} 시작`,
    `👥 모집 인원 ${s.joined_count} / ${s.capacity}명`,
    `📌 ${shareStatusLabel(s.status, s.join_closed)}`,
    '',
    '🔗 내전 참여하기',
    url,
  ].join('\n');
}

/** ISO → KST 입력값(`<input type=date>`·`<input type=time>`) */
export function isoToKstInputs(iso: string): { date: string; time: string } {
  const k = kst(Date.parse(iso));
  return { date: `${k.y}-${p2(k.m)}-${p2(k.d)}`, time: `${p2(k.hh)}:${p2(k.mm)}` };
}

/** KST 입력값 → `YYYY-MM-DDTHH:mm:00+09:00`. 형식이 틀리면 null */
export function kstInputsToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const iso = `${date}T${time}:00+09:00`;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  // 2026-02-31 같은 값은 Date가 다음 달로 넘기므로 되돌려 비교한다
  const back = isoToKstInputs(new Date(t).toISOString());
  return back.date === date && back.time === time ? iso : null;
}

/** 작성 폼 기본 시작 시각: 지금부터 1시간 뒤 이후의 가장 가까운 정각(KST) */
export function defaultScheduleInputs(now: number): { date: string; time: string } {
  const t = Math.ceil((now + 3_600_000) / 3_600_000) * 3_600_000;
  return isoToKstInputs(new Date(t).toISOString());
}

/** 카운트다운 `02:14:33`, 하루 이상이면 `2일 03:10:00`. 음수는 0 */
export function formatHms(sec: number): string {
  const v = Math.max(0, Math.floor(sec));
  const d = Math.floor(v / 86_400);
  const h = Math.floor((v % 86_400) / 3_600);
  const m = Math.floor((v % 3_600) / 60);
  const s = v % 60;
  const hms = `${p2(h)}:${p2(m)}:${p2(s)}`;
  return d > 0 ? `${d}일 ${hms}` : hms;
}

// -----------------------------------------------------------------------------
// 카드·배지
// -----------------------------------------------------------------------------

export type BadgeTone = 'accent' | 'orange' | 'cyan' | 'violet' | 'neutral';

/** 목록 카드 상태 배지(계약 8절): 내 상태 우선, 그 외 status·join_closed. S3: 진행 중 + 결과 pending → 「승인 대기」 */
export function scrimCardBadge(
  s: Pick<ScrimSummary, 'status' | 'join_closed' | 'my_status'> & { result_status?: ScrimSummary['result_status'] },
): { label: string; tone: BadgeTone } {
  if (s.my_status === 'joined' && isOpenStatus(s.status)) return { label: '참가 중', tone: 'cyan' };
  if (s.my_status === 'waitlist' && isOpenStatus(s.status)) return { label: '대기 중', tone: 'cyan' };
  switch (s.status) {
    case 'recruiting':
      return s.join_closed ? { label: '시작 대기', tone: 'violet' } : { label: '모집 중', tone: 'accent' };
    case 'full':
      return s.join_closed ? { label: '시작 대기', tone: 'violet' } : { label: '정원 마감', tone: 'orange' };
    case 'playing':
      return s.result_status === 'pending' ? { label: '승인 대기', tone: 'violet' } : { label: '진행 중', tone: 'cyan' };
    case 'finished':
      return { label: '종료', tone: 'neutral' };
    case 'cancelled':
      return { label: '취소됨', tone: 'neutral' };
  }
}

/**
 * 종료 탭 카드 결과 줄(계약 S3 9절): 팀 → 「블루팀 승리」/「레드팀 승리」, 개인 순위 → 「1위 {닉네임}」.
 * finished && outcome일 때만, 그 외 null
 */
export function scrimOutcomeLine(s: Pick<ScrimSummary, 'status' | 'outcome'>): { text: string; team: 'blue' | 'orange' | null } | null {
  if (s.status !== 'finished' || !s.outcome) return null;
  if (s.outcome.winner_team) return { text: `${TEAM_LABEL[s.outcome.winner_team].ko} 승리`, team: s.outcome.winner_team };
  if (s.outcome.winner) return { text: `1위 ${s.outcome.winner.nickname}`, team: null };
  return null;
}

/** 상세 헤더 배지(S2 계약 6절 표 + S3 8절: 팀 구성 완료·승인 대기) */
export function scrimDetailBadge(
  s: Pick<ScrimDetail, 'status' | 'join_closed'> & { balance?: ScrimDetail['balance']; result_status?: ScrimDetail['result_status'] },
): { label: string; tone: BadgeTone } {
  switch (s.status) {
    case 'recruiting':
      return s.join_closed ? { label: '시작 대기', tone: 'violet' } : { label: '모집 중', tone: 'accent' };
    case 'full':
      if (s.balance) return { label: '팀 구성 완료 · 시작 대기', tone: 'violet' };
      return s.join_closed ? { label: '시작 대기', tone: 'violet' } : { label: '정원 마감 · 팀 구성 중', tone: 'orange' };
    case 'playing':
      return s.result_status === 'pending' ? { label: '결과 승인 대기', tone: 'violet' } : { label: '경기 진행 중', tone: 'cyan' };
    case 'finished':
      return { label: '종료', tone: 'neutral' };
    case 'cancelled':
      return { label: '취소된 내전/모집', tone: 'neutral' };
  }
}

/** 진행 방식 태그(목업 「자동 밸런스」「포지션 선택」「ELO 반영」) */
export function scrimOptionTags(o: ScrimOptions): string[] {
  const tags: string[] = [];
  if (o.auto_balance) tags.push('자동 밸런스');
  if (o.use_positions) tags.push('포지션 선택');
  tags.push(o.rated ? 'ELO 반영' : 'ELO 미반영');
  return tags;
}

/** 「서포터 1 · 정글 1 구함」 */
export function openPositionsText(open: readonly OpenPosition[]): string {
  return `${open.map((o) => `${positionLabel(o.position)} ${o.count}`).join(' · ')} 구함`;
}

/**
 * 카드 보조 줄(계약 8절).
 * 모집 중: open_positions → 「… 구함」, 정원 마감 + 대기 → 「대기 N명」, 정원 마감 → 「정원 마감」, 그 외 「N자리 남음」.
 * 시작 후·종료: 「참가 N명」
 */
export function scrimNeedLine(
  s: Pick<ScrimSummary, 'status' | 'capacity' | 'joined_count' | 'waitlist_count' | 'open_positions'>,
): { text: string; emphasis: boolean } {
  if (!isOpenStatus(s.status)) return { text: `참가 ${s.joined_count}명`, emphasis: false };
  if (s.joined_count >= s.capacity) {
    return s.waitlist_count > 0 ? { text: `대기 ${s.waitlist_count}명`, emphasis: false } : { text: '정원 마감', emphasis: false };
  }
  if (s.open_positions.length > 0) return { text: openPositionsText(s.open_positions), emphasis: true };
  return { text: `${s.capacity - s.joined_count}자리 남음`, emphasis: true };
}

/** 카드 버튼 문구(D91: 모두 상세로 이동, 문구만 다름) */
export function scrimCardAction(s: Pick<ScrimSummary, 'status' | 'join_closed' | 'my_status' | 'capacity' | 'joined_count'>): {
  label: string;
  tone: 'primary' | 'secondary' | 'mine';
} {
  if (isOpenStatus(s.status) && s.my_status === 'joined') return { label: '참가 중 · 상세 보기', tone: 'mine' };
  if (isOpenStatus(s.status) && s.my_status === 'waitlist') return { label: '대기 중 · 상세 보기', tone: 'mine' };
  if (isOpenStatus(s.status) && !s.join_closed) {
    return s.status === 'full' || s.joined_count >= s.capacity
      ? { label: '대기열 등록', tone: 'secondary' }
      : { label: '참가하기', tone: 'primary' };
  }
  return { label: '상세 보기', tone: 'secondary' };
}

/** 인원 칸 capacity개: 앞의 joined_count개가 찬 칸 */
export function capacityPips(joined: number, capacity: number): boolean[] {
  return Array.from({ length: capacity }, (_, i) => i < joined);
}

// -----------------------------------------------------------------------------
// 상세
// -----------------------------------------------------------------------------

export const SCRIM_STEP_LABELS = ['모집', '팀 구성', '경기 진행', '결과 승인'] as const;
export type StepState = 'done' | 'current' | 'todo';

export interface ScrimStep {
  label: string;
  state: StepState;
  /** 단계 아래 보조 문구(「시작 대기」「결과 반려됨」「승인 대기」 등) */
  note: string | null;
}

/**
 * 진행 단계(S3 계약 8절 표, S2 6절 표 대체). cancelled면 null(단계 대신 「취소된 내전」).
 * - recruiting: 1단계 진행 중(join_closed면 「시작 대기」)
 * - full: 팀 게임은 2단계 진행 중(balance 있으면 「팀 구성 완료 · 시작 대기」, 없으면 「정원 마감 · 팀 구성 중」).
 *   개인 순위 게임은 2단계 이름이 「참가 확정」이고 완료로 표시(「시작 대기」)
 * - playing: 3단계 진행 중(rejected면 「결과 반려됨」), pending이면 4단계 진행 중 「승인 대기」
 * - finished: 모두 완료
 */
export function scrimSteps(
  s: Pick<ScrimDetail, 'status' | 'join_closed' | 'result_status' | 'balance'> & { game: Pick<ScrimDetail['game'], 'has_teams'> },
): ScrimStep[] | null {
  if (s.status === 'cancelled') return null;
  const teams = s.game.has_teams;
  const labels = [SCRIM_STEP_LABELS[0], teams ? SCRIM_STEP_LABELS[1] : '참가 확정', SCRIM_STEP_LABELS[2], SCRIM_STEP_LABELS[3]];
  const notes: (string | null)[] = [null, null, null, null];
  /** 이 index 앞은 완료, 이 index는 진행 중(null이면 진행 중 단계 없음) */
  let done = 0;
  let current: number | null = 0;
  switch (s.status) {
    case 'recruiting':
      if (s.join_closed) notes[0] = '시작 대기';
      break;
    case 'full':
      done = 1;
      if (teams) {
        current = 1;
        notes[1] = s.balance ? '팀 구성 완료 · 시작 대기' : '정원 마감 · 팀 구성 중';
      } else {
        done = 2;
        current = null;
        notes[1] = '시작 대기';
      }
      break;
    case 'playing':
      if (s.result_status === 'pending') {
        done = 3;
        current = 3;
        notes[3] = '승인 대기';
      } else {
        done = 2;
        current = 2;
        if (s.result_status === 'rejected') notes[2] = '결과 반려됨';
      }
      break;
    case 'finished':
      done = 4;
      current = null;
      break;
  }
  return labels.map((label, i) => ({
    label,
    state: i < done ? 'done' : i === current ? 'current' : 'todo',
    note: notes[i] ?? null,
  }));
}

export const CANCEL_REASON_TEXT: Record<ScrimCancelReason, string> = {
  host: '방장이 모집을 취소했어요.',
  admin: '운영진이 모집을 취소했어요.',
  not_started: '시작 시각이 지나도 시작되지 않아 자동으로 취소됐어요.',
};

/** 수정 대화상자 정원 하한: max(min, 참가 확정 인원)을 step 간격 위 값으로 올림(D79, D96) */
export function capacityFloor(range: GameCapacityRange, joinedCount: number): number {
  const floor = Math.max(range.min, joinedCount);
  return range.min + Math.ceil((floor - range.min) / range.step) * range.step;
}

/** 시작 버튼이 비활성일 때 이유(D78, D96). range가 없으면(게임 목록 못 받음) 일반 문구 */
export function startBlockedReason(capacity: number, range: GameCapacityRange | undefined): string {
  if (range?.start_requires_full) return `정원 ${capacity}명이 모두 모여야 시작할 수 있어요.`;
  if (range) return `${SCRIM_MIN_PLAYERS_TO_START}명 이상 모여야 시작할 수 있어요.`;
  return '시작 조건(인원)을 아직 채우지 못했어요.';
}

/** 1·2지망 → 요청 배열(빈 2지망·같은 값은 뺀다) */
export function toPreferredPositions(first: string | null, second: string | null): string[] {
  if (!first) return [];
  return second && second !== first ? [first, second] : [first];
}

export function samePositions(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * 라인 추천으로 1지망·2지망 기본 선택을 채울 값(계약 S4 20-5, D192). 채우지 않으면 null.
 * - 포지션을 받는 상태(eligible)이고, 사용자가 아직 건드리지 않았고, 둘 다 비어 있을 때만
 * - 추천이 아직 없거나(로딩·오류) 다른 게임 것이거나 비어 있으면 채우지 않는다(빈 선택 그대로)
 * - 그 게임 포지션에 없는 값은 버린다
 */
export function positionSuggestionFill(input: {
  eligible: boolean;
  touched: boolean;
  game: GameCode | null;
  allowed: readonly string[];
  first: string | null;
  second: string | null;
  suggestion: Pick<GetMyPositionSuggestionsResponse, 'game' | 'positions' | 'sample_size'> | undefined;
}): { first: string; second: string | null; sampleSize: number } | null {
  const { suggestion: s } = input;
  if (!input.eligible || input.touched || input.first !== null || input.second !== null) return null;
  if (!s || s.game !== input.game) return null;
  const picked = s.positions.filter((p) => input.allowed.includes(p));
  if (picked.length === 0) return null;
  return { first: picked[0]!, second: picked[1] ?? null, sampleSize: s.sample_size };
}

/** 추천으로 채운 상태 그대로일 때 고르는 칸 아래 안내(20-5) */
export function positionSuggestionHint(sampleSize: number): string {
  return `솔로 랭크 최근 ${sampleSize}경기 기준으로 골라 뒀어요. 바꿔도 돼요.`;
}

/** 「미드 / 탑」 */
export function positionsText(positions: readonly string[]): string {
  return positions.length ? positions.map(positionLabel).join(' / ') : '';
}

// -----------------------------------------------------------------------------
// 노쇼 제한
// -----------------------------------------------------------------------------

/**
 * 「노쇼가 누적되어 10.28 21:00까지 내전을 만들거나 참가할 수 없어요」(계약 8절, D99).
 * recent_no_show_count는 제한을 일으킨 횟수가 아니라서 넣지 않는다.
 */
export function restrictionUntilText(until: string): string {
  return `노쇼가 누적되어 ${kstMonthDayTime(until)}까지 내전을 만들거나 참가할 수 없어요`;
}

/** 제한 배너 문구(D99). 제한이 아니면 null */
export function restrictionText(r: Pick<ScrimRestriction, 'restricted' | 'until'>): string | null {
  if (!r.restricted || !r.until) return null;
  return restrictionUntilText(r.until);
}

/** 방장 메뉴 자동 마감 안내(D101). 정책 값이 없으면(제한 조회 전·실패) 숫자 없는 문구 */
export function autoCloseHintText(scrimPolicy: Pick<ScrimPolicyView, 'auto_close_after_min'> | null | undefined): string {
  return scrimPolicy
    ? `시작 시각 ${scrimPolicy.auto_close_after_min}분 뒤까지 시작하지 않으면 자동으로 정리돼요.`
    : '시작 시각이 한참 지나도 시작하지 않으면 자동으로 정리돼요.';
}

/** 운영진 노쇼 표시 기한 안내(D101·D102) */
export function noShowMarkHintText(policy: Pick<NoShowPolicyView, 'mark_window_days'>): string {
  return `시작 후 ${policy.mark_window_days}일 안에만 표시할 수 있어요. 정정은 언제든 할 수 있어요.`;
}

/** 운영진 노쇼 확인 대화상자의 규칙 문구(D101). 정책 값이 없으면 숫자 없는 문구 */
export function noShowRuleText(policy: Pick<NoShowPolicyView, 'window_days' | 'threshold' | 'restriction_days'> | null | undefined): string {
  return policy
    ? `최근 ${policy.window_days}일 노쇼가 ${policy.threshold}회가 되면 ${policy.restriction_days}일 동안 내전 참가·모집이 제한돼요.`
    : '노쇼가 누적되면 일정 기간 내전 참가·모집이 제한돼요.';
}

/**
 * 시작 시각 상한(ms) = now + schedule_max_days_ahead일. 정책 값이 없으면(제한 조회 전·실패) null —
 * 그때는 상한 사전 검사를 하지 않고 서버 VALIDATION_FAILED에 맡긴다(D101)
 */
export function scheduleMaxMs(now: number, scrimPolicy: Pick<ScrimPolicyView, 'schedule_max_days_ahead'> | null | undefined): number | null {
  return scrimPolicy ? now + scrimPolicy.schedule_max_days_ahead * DAY_MS : null;
}

/** 작성·수정 폼 시작 시각 상한 문구(D101) */
export function scheduleMaxText(scrimPolicy: Pick<ScrimPolicyView, 'schedule_max_days_ahead'>): string {
  return `${scrimPolicy.schedule_max_days_ahead}일 안의 시각만 고를 수 있어요.`;
}

/** 제한 규칙 안내(정책 값) */
export function restrictionPolicyText(r: Pick<ScrimRestriction, 'policy'>): string {
  const { threshold, window_days, restriction_days } = r.policy;
  return `최근 ${window_days}일 안에 노쇼가 ${threshold}회 쌓이면 ${restriction_days}일 동안 새 참가·대기 등록·모집글 작성이 막혀요. 제한 중에 기준을 채우는 노쇼가 또 생기면 그만큼 늦게 풀려요. 이미 참가한 내전은 그대로예요.`;
}

/** 해제 시각 툴팁·짧은 안내 「10.28 21:00 해제」 */
export function restrictionUntilShort(until: string): string {
  return `${kstMonthDayTime(until)} 해제`;
}

/**
 * 내전 API 오류 문구. SCRIM_BANNED는 Retry-After(초)로 해제 시각을 붙인다(정확한 값은 GET /me/scrim-restriction이 다시 채운다).
 */
export function scrimBannedUntilFromRetry(retryAfterSec: number | undefined, now: number): string | null {
  if (retryAfterSec === undefined || retryAfterSec <= 0) return null;
  return new Date(now + retryAfterSec * 1000).toISOString();
}

/** 바뀐 필드만 담는다(PATCH는 1개 이상 필요). 바뀐 게 없으면 null */
export function buildScrimPatch(
  s: Pick<ScrimDetail, 'title' | 'scheduled_at' | 'capacity' | 'rules' | 'options'> & { steam_app?: ScrimDetail['steam_app'] },
  next: {
    title: string;
    scheduledIso: string;
    capacity: number;
    rules: string;
    rated: boolean;
    autoBalance: boolean;
    /** 스팀 게임(D98). 고르지 않았으면(null·생략) 보내지 않는다 */
    steamAppId?: number | null;
  },
): UpdateScrimRequestInput | null {
  const patch: UpdateScrimRequestInput = {};
  if (next.title.trim().replace(/\s+/g, ' ') !== s.title) patch.title = next.title;
  if (Date.parse(next.scheduledIso) !== Date.parse(s.scheduled_at)) patch.scheduled_at = next.scheduledIso;
  if (next.capacity !== s.capacity) patch.capacity = next.capacity;
  const rules = next.rules.trim();
  if (rules !== (s.rules ?? '')) patch.rules = rules === '' ? null : next.rules;
  if (next.rated !== s.options.rated) patch.rated = next.rated;
  if (next.autoBalance !== s.options.auto_balance) patch.auto_balance = next.autoBalance;
  if (next.steamAppId != null && next.steamAppId !== s.steam_app?.app_id) patch.steam_app_id = next.steamAppId;
  return Object.keys(patch).length ? patch : null;
}

