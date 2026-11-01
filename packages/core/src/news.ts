import { DAY_MS } from './config';
import { kstDateKey } from './time';

// =============================================================================
// S6 공지·패치노트·이벤트(계약 S6 8-2·8-3, D254·D258). 날짜는 KST 달력 날짜 문자열 'YYYY-MM-DD'.
// =============================================================================

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(v: string, name: string): number {
  const ms = typeof v === 'string' && ISO_DATE_RE.test(v) ? Date.parse(`${v}T00:00:00.000Z`) : Number.NaN;
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== v) {
    throw new RangeError(`${name}: 올바른 YYYY-MM-DD 날짜가 아님 (${String(v)})`);
  }
  return ms;
}

const formatIsoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** 날짜 문자열에 일수 더하기(음수 허용) */
function addIsoDays(v: string, days: number): string {
  return formatIsoDate(parseIsoDate(v, 'date') + days * DAY_MS);
}

function monthBounds(v: string, name: string): { first: string; last: string } {
  const d = new Date(parseIsoDate(v, name));
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return { first: formatIsoDate(Date.UTC(y, m, 1)), last: formatIsoDate(Date.UTC(y, m + 1, 0)) };
}

/**
 * 홈 항목 부제(8-3). text를 앞뒤 공백 제거한 뒤 첫 줄(\r\n·\r·\n 기준)을 다시 앞뒤 공백 제거. 비면 null.
 * 코드 포인트 기준 max자 초과면 앞 (max − 1)자 + '…'. max가 2 이상 정수가 아니면 RangeError.
 */
export function newsSubtitle(text: string | null, max: number): string | null {
  if (!Number.isInteger(max) || max < 2) throw new RangeError(`max: 2 이상의 정수여야 함 (${max})`);
  if (text == null) return null;
  const line = (text.trim().split(/\r\n|\r|\n/)[0] ?? '').trim();
  if (line === '') return null;
  const chars = Array.from(line);
  if (chars.length <= max) return line;
  return `${chars.slice(0, max - 1).join('')}…`;
}

/**
 * GET /events 기본 구간(8-2). 둘 다 없으면 kstDateKey(now)가 속한 달의 1일·말일.
 * 하나만 있으면 그 날짜가 속한 달의 1일(from 비었을 때)·말일(to 비었을 때)로 채운다. 둘 다 있으면 그대로.
 * 검증(to ≥ from, 92일)은 shared가 이미 했다. 형식이 틀리면 RangeError.
 */
export function resolveEventsRange(query: { from?: string; to?: string }, now: Date): { from: string; to: string } {
  const { from, to } = query;
  if (from !== undefined && to !== undefined) {
    parseIsoDate(from, 'from');
    parseIsoDate(to, 'to');
    return { from, to };
  }
  if (from !== undefined) return { from, to: monthBounds(from, 'from').last };
  if (to !== undefined) return { from: monthBounds(to, 'to').first, to };
  const today = monthBounds(kstDateKey(now), 'now');
  return { from: today.first, to: today.last };
}

/** 홈 news 구간(8-3): today = kstDateKey(now), patchSince = today − patchRecentDays, eventUntil = today + eventAheadDays */
export function dashboardNewsWindow(
  now: Date,
  patchRecentDays: number,
  eventAheadDays: number,
): { today: string; patchSince: string; eventUntil: string } {
  if (!Number.isInteger(patchRecentDays) || patchRecentDays < 0) {
    throw new RangeError(`patchRecentDays: 0 이상의 정수여야 함 (${patchRecentDays})`);
  }
  if (!Number.isInteger(eventAheadDays) || eventAheadDays < 0) {
    throw new RangeError(`eventAheadDays: 0 이상의 정수여야 함 (${eventAheadDays})`);
  }
  const today = kstDateKey(now);
  return { today, patchSince: addIsoDays(today, -patchRecentDays), eventUntil: addIsoDays(today, eventAheadDays) };
}
