/**
 * 시각·숫자 표기. 사용자는 한국에 있으므로 표시는 항상 KST(Asia/Seoul)로 고정한다
 * (서버 하루 경계·새로고침 횟수 초기화도 KST라 화면과 어긋나지 않게).
 */

const KST = 'Asia/Seoul';

function kstParts(d: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: KST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour'), mm: get('minute') };
}

/** `22:41` */
export function formatClock(iso: string): string {
  const p = kstParts(new Date(iso));
  return `${p.hh}:${p.mm}`;
}

/** `10.20` (목업 「마지막 성공 값(10.20)」) */
export function formatMonthDay(iso: string): string {
  const p = kstParts(new Date(iso));
  return `${p.m}.${p.d}`;
}

/** `2026.03` (목업 「2026.03 가입」) */
export function formatYearMonth(iso: string): string {
  const p = kstParts(new Date(iso));
  return `${p.y}.${p.m}`;
}

/** 전체 시각(툴팁용) `2026.10.28 22:41` */
export function formatFull(iso: string): string {
  const p = kstParts(new Date(iso));
  return `${p.y}.${p.m}.${p.d} ${p.hh}:${p.mm}`;
}

/**
 * 갱신 시각 표기(nextjs-dashboard-ui 4절 「N분 전 갱신」 + 목업 「22:41 동기화」).
 * 1분 미만 「방금」, 1시간 미만 「N분 전」, 같은 KST 날짜면 「HH:mm」, 그 밖은 「MM.DD HH:mm」.
 */
export function formatSyncedAt(iso: string, now: number): string {
  const t = Date.parse(iso);
  const diff = now - t;
  if (diff < 60_000) return '방금';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  const a = kstParts(new Date(t));
  const b = kstParts(new Date(now));
  if (a.y === b.y && a.m === b.m && a.d === b.d) return `${a.hh}:${a.mm}`;
  return `${a.m}.${a.d} ${a.hh}:${a.mm}`;
}

/** 지난 경기 표기: 「N분 전」「N시간 전」「어제」「N일 전」 */
export function formatAgo(iso: string, now: number): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return d === 1 ? '어제' : `${d}일 전`;
}

/** 경기 시간 `31:12` */
export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 카운트다운 `08:42`. 음수는 00:00 */
export function formatCountdown(sec: number): string {
  const v = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}
