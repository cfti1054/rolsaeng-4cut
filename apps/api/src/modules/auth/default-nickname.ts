import { randomInt } from 'node:crypto';
import { NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH, Nickname, normalizeNickname } from '@gcd/shared';

/**
 * 기본 닉네임 생성(계약 5-7, 신규 사용자만).
 * 1. 후보 순서대로(길드 nick → global_name → username) 다듬어 2자 이상인 첫 값.
 * 2. 모두 실패하면 fallback(`user{discord_id 끝 4자리}` 또는 `user{난수 4자리}`).
 * 3. 다른 사용자가 쓰면 (앞 10자 trimEnd) + 2..99, 그래도 겹치면 (앞 8자 trimEnd) + 난수 4자리.
 * 결과는 항상 Nickname 스키마를 통과하고 normalizeNickname(결과) === 결과.
 */

const DISALLOWED = /[^0-9A-Za-z가-힣_\s]/g;

/** 후보 하나를 닉네임 규칙에 맞게 다듬는다. 2자 미만이면 null. */
export function sanitizeNicknameCandidate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = normalizeNickname(raw.replace(DISALLOWED, ''))
    .slice(0, NICKNAME_MAX_LENGTH)
    .trim();
  if (cleaned.length < NICKNAME_MIN_LENGTH) return null;
  return Nickname.safeParse(cleaned).success ? cleaned : null;
}

export function random4Digits(): string {
  return String(randomInt(0, 10000)).padStart(4, '0');
}

export interface DeriveNicknameOptions {
  /** 우선순위 순 후보 */
  candidates: Array<string | null | undefined>;
  /** 모든 후보가 실패했을 때 쓸 값(`user` + 4자리) */
  fallback: string;
  /** 이미 다른 사용자가 쓰는지 */
  isTaken: (nickname: string) => Promise<boolean>;
  /** 테스트 주입용 */
  random4?: () => string;
  /** 난수 접미사 시도 횟수(기본 20) */
  maxRandomAttempts?: number;
}

export async function deriveDefaultNickname(opts: DeriveNicknameOptions): Promise<string> {
  const random4 = opts.random4 ?? random4Digits;
  let base: string | null = null;
  for (const c of opts.candidates) {
    base = sanitizeNicknameCandidate(c);
    if (base) break;
  }
  base ??= sanitizeNicknameCandidate(opts.fallback) ?? `user${random4()}`;

  if (!(await opts.isTaken(base))) return base;

  const head10 = base.slice(0, 10).trimEnd();
  for (let n = 2; n <= 99; n += 1) {
    const candidate = `${head10}${n}`;
    if (!(await opts.isTaken(candidate))) return candidate;
  }

  const head8 = base.slice(0, 8).trimEnd();
  const attempts = opts.maxRandomAttempts ?? 20;
  for (let i = 0; i < attempts; i += 1) {
    const candidate = `${head8}${random4()}`;
    if (!(await opts.isTaken(candidate))) return candidate;
  }
  throw new Error('기본 닉네임을 만들지 못했습니다(후보 소진).');
}

/** 디스코드 사용자 fallback: `user{discord_id 끝 4자리}` */
export function discordFallbackNickname(discordId: string): string {
  const tail = discordId.replace(/\D/g, '').slice(-4);
  return `user${tail.length === 4 ? tail : random4Digits()}`;
}
