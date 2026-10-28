import { NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH, Nickname, normalizeNickname } from '@gcd/shared';

/**
 * 닉네임 입력 검증(계약 5-7, D6). 서버와 같은 shared `Nickname` 스키마를 쓴다.
 * 규칙: 앞뒤 공백 제거·연속 공백 1개로 정규화(거부하지 않음) → 2–12자 → 한글 완성형·영문·숫자·밑줄·공백만.
 */
export type NicknameCheck =
  | { ok: true; value: string; normalized: boolean }
  | { ok: false; message: string; length: number };

export const NICKNAME_RULE_HINT = `${NICKNAME_MIN_LENGTH}–${NICKNAME_MAX_LENGTH}자 · 한글 · 영문 · 숫자 · 밑줄 · 공백`;

export function checkNickname(raw: string): NicknameCheck {
  const normalized = normalizeNickname(raw);
  const length = normalized.length;
  if (length === 0) return { ok: false, message: '닉네임을 입력해 주세요.', length };
  if (length < NICKNAME_MIN_LENGTH) {
    return { ok: false, message: `${NICKNAME_MIN_LENGTH}자 이상 입력해 주세요.`, length };
  }
  if (length > NICKNAME_MAX_LENGTH) {
    return { ok: false, message: `${NICKNAME_MAX_LENGTH}자 이하로 입력해 주세요. (지금 ${length}자)`, length };
  }
  const parsed = Nickname.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: hasJamo(normalized)
        ? '한글은 완성된 글자만 쓸 수 있어요. (ㄱ, ㅏ 같은 낱자는 안 돼요)'
        : '한글 · 영문 · 숫자 · 밑줄(_) · 공백만 쓸 수 있어요.',
      length,
    };
  }
  return { ok: true, value: parsed.data, normalized: parsed.data !== raw };
}

function hasJamo(s: string): boolean {
  return /[ᄀ-ᇿ㄰-㆏]/.test(s);
}
