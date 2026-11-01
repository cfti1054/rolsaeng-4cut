import {
  API_KEY_PREFIX,
  EVENT_SPAN_MAX_DAYS,
  BOT_ANNOUNCEMENT_PENDING_MAX_AGE_HOURS,
  SCRIM_RESULT_REVERT_WINDOW_DAYS,
  type AdminAuditAction,
  type AdminMemberItem,
  type AdminMemberSort,
  type AdminNoShowPlayer,
  type AdminOverview,
  type AdminResultItem,
  type AdminResultView,
  type AdminSeasonPhase,
  type AdminUpcoming,
  type EventScheduleIssue,
  type ApiKeyScope,
  type NoShowPolicyView,
  type ScrimResultRevertBlock,
} from '@gcd/shared';
import { formatAgo, formatClock, formatMonthDay } from './format';
import { GAME_META } from './games';
import { WEEKDAY_LABELS, eventTimeText } from './news';
import { routes } from './routes';
import { kstClock } from './scrims';
import { TEAM_LABEL } from './scrim-results';
import type { AdminTab } from './routes';

/**
 * S6 관리자 화면 로직(순수 함수, 단위 테스트 대상). 계약 S6 13절.
 * 숫자는 shared 상수(되돌리기 기한 7일, 봇 대기 72시간)와 서버 응답(노쇼 정책)만 쓴다.
 */

export const ADMIN_TAB_LABEL: Record<AdminTab, string> = {
  results: '결과·노쇼',
  members: '멤버',
  news: '공지·소식',
  seasons: '분기',
  'api-keys': 'API 키',
  audit: '감사 로그',
};

/** 승인 되돌리기를 막는 이유 문구(계약 S6 13절). rating_mismatch는 시도 응답으로만 온다 */
export const REVERT_BLOCK_TEXT: Record<ScrimResultRevertBlock, string> = {
  self_submitted: '내가 제출한 결과는 다른 운영진이 되돌려야 해요',
  window_passed: `승인 후 ${SCRIM_RESULT_REVERT_WINDOW_DAYS}일이 지나 되돌릴 수 없어요`,
  season_closed: '분기 종료 처리가 끝나 되돌릴 수 없어요',
  later_games: '참가자의 다음 경기가 이미 반영돼 되돌릴 수 없어요',
  rating_mismatch: '레이팅 기록이 맞지 않아요. 개발자에게 알려 주세요',
};

/** 되돌리기 확인 대화상자 본문(큐·상세 공통) */
export const REVERT_CONFIRM_TEXT = '참가자 레이팅이 승인 전으로 돌아가고 내전은 결과 재입력 상태가 돼요';

/**
 * 되돌리기 실패 문구(리더 결정 B안). SCRIM_RESULT_REVERT_NOT_ALLOWED의 이유는 서버 message에만 있고 화면은 code로 정한다(S0 3절).
 * 오류 뒤 다시 읽은 큐·상세의 revert_blocked_reason이 있으면 그 이유 문구, 없으면(시도 때만 판정되는) rating_mismatch 문구.
 * 다른 code는 null(호출한 쪽이 일반 문구).
 */
export function revertErrorText(code: string, blocked: ScrimResultRevertBlock | null | undefined): string | null {
  if (code !== 'SCRIM_RESULT_REVERT_NOT_ALLOWED') return null;
  return REVERT_BLOCK_TEXT[blocked ?? 'rating_mismatch'];
}

export const RESULT_VIEW_LABEL: Record<AdminResultView, string> = {
  pending: '대기',
  approved: '최근 승인',
};

/** 큐 결과 문구: 팀 「블루팀 승리」, 개인 「1위 {닉네임}」 */
export function resultOutcomeText(o: AdminResultItem['outcome']): string {
  if (o?.winner_team) return `${TEAM_LABEL[o.winner_team].ko} 승리`;
  if (o?.winner) return `1위 ${o.winner.nickname}`;
  return '결과 없음';
}

export type StatDot = 'accent' | 'orange' | 'violet' | 'cyan';
export interface OverviewCard {
  key: 'pending' | 'scrims_week' | 'no_shows';
  label: string;
  value: number;
  unit: string;
  sub: string;
  dot: StatDot;
}

/**
 * 통계 3칸(D291, 목업 Admin 상단 4칸에서 「참가 제한 중」을 뺐다). 화면의 통계 4칸 = 이 3칸 + 「다가오는 일정」(upcomingRows, D306),
 * 그 아래 전체 폭 캘린더.
 * 응답 restricted_members는 그대로 오지만 화면에는 쓰지 않는다(멤버 탭 STATUS 열이 같은 정보). now = 화면 시각(ms)
 */
export function overviewCards(o: AdminOverview, now: number): OverviewCard[] {
  const diff = o.no_shows.this_month - o.no_shows.last_month;
  return [
    {
      key: 'pending',
      label: '결과 승인 대기',
      value: o.pending_results.count,
      unit: '건',
      sub: o.pending_results.oldest_submitted_at ? `가장 오래된 제출 · ${formatAgo(o.pending_results.oldest_submitted_at, now)}` : '대기 중인 결과가 없어요',
      dot: 'accent',
    },
    {
      // 목업 두 번째 칸 자리(그 칸의 기능은 D281로 제거)
      key: 'scrims_week',
      label: '이번 주 내전',
      value: o.scrims_this_week,
      unit: '경기',
      sub: '월요일부터 · 취소 제외',
      dot: 'orange',
    },
    {
      key: 'no_shows',
      label: '이번 달 노쇼',
      value: o.no_shows.this_month,
      unit: '회',
      sub: diff < 0 ? `지난달보다 ${-diff}회 적어요` : diff > 0 ? `지난달보다 ${diff}회 많아요` : '지난달과 같아요',
      dot: 'violet',
    },
  ];
}

// -----------------------------------------------------------------------------
// 「다가오는 일정」 카드(계약 S6 23-8-5, D306)
// -----------------------------------------------------------------------------

export const UPCOMING_EMPTY_TEXT = '다가오는 일정이 없어요';

export interface UpcomingRow {
  key: string;
  kind: 'event' | 'scrim';
  /** 「11.08 (일)」 또는 진행 중 여러 날 일정 「진행 중 · ~11.10」 */
  date: string;
  /** 「종일」 | 「21:00」 | 「21:00–23:00」 */
  time: string;
  /** 게임 약칭 또는 「게임 무관」 */
  game: string;
  title: string;
  chip: '일정' | '내전' | '모집';
  /** 내전 상세 링크. 일정은 null(편집은 아래 캘린더) */
  href: string | null;
  /** 링크 접근성 이름 「11월 13일 21:00 금요 5:5 내전 상세」(내전만) */
  linkLabel: string | null;
  /** 내 참가(my_status 있음) */
  bold: boolean;
}

const dot2 = (date: string) => `${date.slice(5, 7)}.${date.slice(8, 10)}`;
const weekdayOf = (date: string) => WEEKDAY_LABELS[(new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7];

/**
 * 「다가오는 일정」 행 보기 모델. 순서 = 응답 순서 그대로(서버 mergeUpcomingItems).
 * - 일정: starts_on < from(이미 시작한 여러 날 일정)이면 「진행 중 · ~MM.DD」(끝날), 아니면 「MM.DD (요일)」. 시각 = eventTimeText. 링크 없음.
 * - 내전: 날짜 = date(서버 kstDateKey), 시각 = scheduled_at KST. 칩 = 승패를 받지 않는 게임(has_results false, 스팀)이면 「모집」, 아니면 「내전」.
 */
export function upcomingRows(u: AdminUpcoming): UpcomingRow[] {
  return u.items.map((it): UpcomingRow => {
    if (it.kind === 'event') {
      return {
        key: `e-${it.id}`,
        kind: 'event',
        date: it.starts_on < u.from ? `진행 중 · ~${dot2(it.ends_on)}` : `${dot2(it.starts_on)} (${weekdayOf(it.starts_on)})`,
        time: eventTimeText(it),
        game: it.game ? (GAME_META[it.game.code]?.short ?? it.game.name) : '게임 무관',
        title: it.title,
        chip: '일정',
        href: null,
        linkLabel: null,
        bold: false,
      };
    }
    const chip = it.game.has_results === false ? '모집' : '내전';
    const time = kstClock(it.scheduled_at);
    return {
      key: `s-${it.id}`,
      kind: 'scrim',
      date: `${dot2(it.date)} (${weekdayOf(it.date)})`,
      time,
      game: GAME_META[it.game.code]?.short ?? it.game.name,
      title: it.title,
      chip,
      href: routes.scrim(it.id),
      // 제목이 칩 문구로 끝나면(「…내전」 + 「내전」) 칩을 생략해 반복하지 않는다
      linkLabel: `${Number(it.date.slice(5, 7))}월 ${Number(it.date.slice(8, 10))}일 ${time} ${it.title.trimEnd().endsWith(chip) ? it.title.trimEnd() : `${it.title} ${chip}`} 상세`,
      bold: it.my_status !== null,
    };
  });
}

/**
 * 일정 기간·시각 검사 결과(shared eventScheduleIssues, 서버 VALIDATION_FAILED details와 같은 path·message)의 화면 문구(해요체).
 * shared 이슈에는 code가 없어 path + shared 메시지로 구분한다. 모르는 이슈는 shared 메시지 그대로(폴백).
 */
export function eventScheduleIssueText(issue: Pick<EventScheduleIssue, 'message'> & { path: string }): string {
  const key = `${issue.path}|${issue.message}`;
  const map: Record<string, string> = {
    'ends_on|ends_on은 starts_on 이후': '종료일은 시작일과 같거나 그 뒤여야 해요',
    [`ends_on|이벤트 기간은 최대 ${EVENT_SPAN_MAX_DAYS}일`]: `일정 기간은 최대 ${EVENT_SPAN_MAX_DAYS}일까지예요`,
    'end_time|종료 시각은 시작 시각이 있을 때만': '종료 시각만 입력할 수 없어요. 시작 시각을 먼저 정해 주세요',
    'end_time|종료 시각은 시작 시각 이후': '종료 시각은 시작 시각 이후여야 해요',
    'start_time|HH:mm 형식이어야 함': '시각은 HH:mm 형식이어야 해요',
    'end_time|HH:mm 형식이어야 함': '시각은 HH:mm 형식이어야 해요',
  };
  return map[key] ?? issue.message;
}

/** 머리 「랭킹 캐시 HH:mm 갱신」. failing_keys > 0이면 warn(경고 점) */
export function rankingCacheText(rc: AdminOverview['ranking_cache']): { text: string; warn: boolean } {
  const warn = rc.failing_keys > 0;
  const base = rc.last_computed_at ? `랭킹 캐시 ${formatClock(rc.last_computed_at)} 갱신` : '랭킹 캐시 기록 없음';
  return { text: warn ? `${base} · 실패 ${rc.failing_keys}개` : base, warn };
}

// -----------------------------------------------------------------------------
// 노쇼
// -----------------------------------------------------------------------------

/** 「30일 안에 3회면 1일간 참가 제한」 — 서버 정책값(Q17, 목업의 7일은 예시) */
export function noShowPolicyText(p: NoShowPolicyView): string {
  return `${p.window_days}일 안에 ${p.threshold}회면 ${p.restriction_days}일간 참가 제한`;
}

/** 행 태그: 제한 중 > 표시하면 제한 > 없음 */
export function noShowTag(p: Pick<AdminNoShowPlayer, 'restricted_until' | 'restrict_if_marked'>): { text: string; tone: 'warn' | 'restrict' } | null {
  if (p.restricted_until) return { text: `제한 중 ~${formatMonthDay(p.restricted_until)}`, tone: 'warn' };
  if (p.restrict_if_marked) return { text: '표시하면 참가 제한', tone: 'restrict' };
  return null;
}

export interface NoShowChange {
  userId: string;
  noShow: boolean;
}

/** 체크 상태와 서버 상태를 비교해 바뀐 참가자만(서버 순서 그대로) */
export function noShowChanges(players: readonly Pick<AdminNoShowPlayer, 'user' | 'status'>[], checked: ReadonlySet<string>): NoShowChange[] {
  return players.flatMap((p) => {
    const now = checked.has(p.user.id);
    return now !== (p.status === 'no_show') ? [{ userId: p.user.id, noShow: now }] : [];
  });
}

/**
 * 바뀐 참가자만 기존 노쇼 API를 차례로 부르고 첫 실패에서 멈춘다(D252, Q16).
 * 반환: 성공한 수와 실패(있으면 실패한 변경과 오류).
 */
export async function runNoShowChanges(
  changes: readonly NoShowChange[],
  call: (c: NoShowChange) => Promise<unknown>,
): Promise<{ saved: number; failed: { change: NoShowChange; error: unknown } | null }> {
  let saved = 0;
  for (const c of changes) {
    try {
      await call(c);
      saved += 1;
    } catch (error) {
      return { saved, failed: { change: c, error } };
    }
  }
  return { saved, failed: null };
}

// -----------------------------------------------------------------------------
// 공지·패치노트 디스코드 상태(계약 S6 8-4)
// -----------------------------------------------------------------------------

export type DiscordDelivery = 'off' | 'pending' | 'sent' | 'expired';

export function discordDelivery(n: { notify_discord: boolean; discord_notified_at: string | null; created_at: string }, now: number): DiscordDelivery {
  if (n.discord_notified_at) return 'sent';
  if (!n.notify_discord) return 'off';
  return now - Date.parse(n.created_at) >= BOT_ANNOUNCEMENT_PENDING_MAX_AGE_HOURS * 3_600_000 ? 'expired' : 'pending';
}

export function discordDeliveryText(n: { notify_discord: boolean; discord_notified_at: string | null; created_at: string }, now: number): string | null {
  switch (discordDelivery(n, now)) {
    case 'off':
      return null;
    case 'pending':
      return '디스코드 전송 대기';
    case 'sent':
      return `디스코드 전송됨 ${formatClock(n.discord_notified_at!)}`;
    case 'expired':
      return `디스코드 전송 안 됨(${BOT_ANNOUNCEMENT_PENDING_MAX_AGE_HOURS}시간 경과)`;
  }
}

// -----------------------------------------------------------------------------
// 멤버
// -----------------------------------------------------------------------------

export const MEMBER_SORT_LABEL: Record<AdminMemberSort, string> = {
  joined_desc: '최근 가입순',
  nickname_asc: '닉네임순',
  scrims_desc: '내전 많은 순',
  no_show_desc: '노쇼 많은 순',
  last_login_desc: '최근 접속순',
};

/** STATUS 열: 활동 중 / 참가 제한 ~MM.DD / 서버 나감 */
export function memberStatusText(m: Pick<AdminMemberItem, 'status' | 'restricted_until'>): { text: string; tone: 'ok' | 'warn' | 'off' } {
  switch (m.status) {
    case 'left':
      return { text: '서버 나감', tone: 'off' };
    case 'restricted':
      return { text: m.restricted_until ? `참가 제한 ~${formatMonthDay(m.restricted_until)}` : '참가 제한', tone: 'warn' };
    default:
      return { text: '활동 중', tone: 'ok' };
  }
}

export const ROLE_LOCKED_TEXT = '서버 설정(ADMIN_DISCORD_IDS)으로 지정된 운영진이에요';

// -----------------------------------------------------------------------------
// 시즌
// -----------------------------------------------------------------------------

export const SEASON_PHASE_LABEL: Record<AdminSeasonPhase, string> = {
  upcoming: '시작 전',
  current: '진행 중',
  ended: '종료 처리 대기',
  closed: '종료',
};

/** ISO 시각 → `<input type="datetime-local">` 값(KST `YYYY-MM-DDTHH:mm`) */
export function isoToKstLocalInput(iso: string): string {
  const d = new Date(Date.parse(iso) + 9 * 3_600_000);
  return d.toISOString().slice(0, 16);
}

/** datetime-local 값(KST로 해석) → ISO(+09:00). 형식이 틀리면 null */
export function kstLocalInputToIso(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const iso = `${v}:00+09:00`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** 진행 중 시즌 끝 변경 확인 문구 */
export function seasonEndConfirmText(endsAtIso: string): string {
  return `시즌이 ${formatMonthDay(endsAtIso)} ${formatClock(endsAtIso)}에 끝나고 종료 처리(최종 순위·뱃지)가 돌아요`;
}

/** 수정 폼에서 실제로 바뀐 필드만(값이 같으면 보내지 않는다 — 서버도 변경으로 보지 않지만 잠긴 칸 오류를 피한다) */
export function seasonPatch(
  current: { name: string; starts_at: string; ends_at: string },
  next: { name: string; starts_at: string | null; ends_at: string | null },
): { name?: string; starts_at?: string; ends_at?: string } {
  const out: { name?: string; starts_at?: string; ends_at?: string } = {};
  if (next.name.trim() !== current.name) out.name = next.name;
  if (next.starts_at && Date.parse(next.starts_at) !== Date.parse(current.starts_at)) out.starts_at = next.starts_at;
  if (next.ends_at && Date.parse(next.ends_at) !== Date.parse(current.ends_at)) out.ends_at = next.ends_at;
  return out;
}

// -----------------------------------------------------------------------------
// API 키·감사 로그
// -----------------------------------------------------------------------------

/** 목록 표기 `gcd_AbCd1234…`(key_prefix = 접두어 뒤 8자, S5 api-key.ts) */
export function apiKeyPrefixText(prefix: string): string {
  return `${API_KEY_PREFIX}${prefix}…`;
}

export const API_KEY_SCOPE_LABEL: Record<ApiKeyScope, string> = {
  'bot:activity': '활동 기록',
  'bot:scrims:read': '내전 조회',
  'bot:users:read': '회원 조회',
  'bot:rankings:read': '랭킹 조회',
  'bot:members': '서버 입장·퇴장',
  'bot:presence': '접속 현황',
  'bot:notices': '공지 전송',
  'bot:patch-notes': '패치노트 DM',
};

export const AUDIT_ACTION_LABEL: Record<AdminAuditAction, string> = {
  'member.role_change': '역할 변경',
  'notice.create': '공지 작성',
  'notice.update': '공지 수정',
  'notice.delete': '공지 삭제',
  'patch_note.create': '패치노트 작성',
  'patch_note.update': '패치노트 수정',
  'patch_note.delete': '패치노트 삭제',
  'event.create': '이벤트 작성',
  'event.update': '이벤트 수정',
  'event.delete': '이벤트 삭제',
  'api_key.create': 'API 키 발급',
  'api_key.revoke': 'API 키 폐기',
  'season.create': '시즌 생성',
  'season.update': '시즌 수정',
  'season.delete': '시즌 삭제',
  'result.revert': '승인 되돌리기',
};
