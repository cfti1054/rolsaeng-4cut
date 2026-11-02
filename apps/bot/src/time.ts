/** 한국은 일광 절약 시간이 없어 KST는 항상 UTC+9다. */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function kstDate(instant: Date): Date {
  return new Date(instant.getTime() + KST_OFFSET_MS);
}

/** `2026-10-27T20:10:00.000+09:00`. shared IsoDateTime(오프셋 있는 ISO)에 맞춘다. */
export function formatIsoWithKstOffset(instant: Date): string {
  const kst = kstDate(instant);
  return (
    `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}` +
    `T${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())}` +
    `.${pad(kst.getUTCMilliseconds(), 3)}+09:00`
  );
}

/** 멱등 키에 쓰는 KST 시각 `yyyyMMddTHHmmss`. */
export function kstCompact(instant: Date): string {
  const kst = kstDate(instant);
  return (
    `${kst.getUTCFullYear()}${pad(kst.getUTCMonth() + 1)}${pad(kst.getUTCDate())}` +
    `T${pad(kst.getUTCHours())}${pad(kst.getUTCMinutes())}${pad(kst.getUTCSeconds())}`
  );
}

/** instant 이후의 다음 KST 자정. instant가 자정이면 다음 날 자정이다. */
export function nextKstMidnight(instant: Date): Date {
  const kstMs = instant.getTime() + KST_OFFSET_MS;
  const dayStart = Math.floor(kstMs / DAY_MS) * DAY_MS;
  return new Date(dayStart + DAY_MS - KST_OFFSET_MS);
}

/** 화면용 `MM/DD HH:mm` (KST). */
export function formatKstClock(instant: Date): string {
  const kst = kstDate(instant);
  return `${pad(kst.getUTCMonth() + 1)}/${pad(kst.getUTCDate())} ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`;
}
