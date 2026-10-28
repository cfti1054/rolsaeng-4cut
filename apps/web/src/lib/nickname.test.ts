import { describe, expect, it } from 'vitest';
import { checkNickname } from './nickname';

describe('checkNickname (계약 5-7, D6)', () => {
  it('한글·영문·숫자·밑줄 2–12자 통과', () => {
    expect(checkNickname('새벽감자')).toEqual({ ok: true, value: '새벽감자', normalized: false });
    expect(checkNickname('Mid_King99')).toMatchObject({ ok: true, value: 'Mid_King99' });
    expect(checkNickname('가나')).toMatchObject({ ok: true });
    expect(checkNickname('가'.repeat(12))).toMatchObject({ ok: true });
  });

  it('공백 허용: 앞뒤 공백 제거, 연속 공백(탭·줄바꿈 포함)은 1개로 정규화', () => {
    expect(checkNickname('새벽 감자')).toEqual({ ok: true, value: '새벽 감자', normalized: false });
    expect(checkNickname('  새벽   감자 ')).toEqual({ ok: true, value: '새벽 감자', normalized: true });
    expect(checkNickname('새벽\t\n감자')).toEqual({ ok: true, value: '새벽 감자', normalized: true });
  });

  it('길이는 정규화한 뒤에 센다', () => {
    // 공백 포함 원문은 14자지만 정규화하면 12자
    expect(checkNickname(' 가나다라마바 사아자차카 ')).toMatchObject({ ok: true, value: '가나다라마바 사아자차카' });
    expect(checkNickname('  가  ')).toMatchObject({ ok: false, message: '2자 이상 입력해 주세요.' });
  });

  it('빈 값·짧음·김', () => {
    expect(checkNickname('')).toMatchObject({ ok: false, message: '닉네임을 입력해 주세요.' });
    expect(checkNickname('   ')).toMatchObject({ ok: false, message: '닉네임을 입력해 주세요.' });
    expect(checkNickname('a')).toMatchObject({ ok: false, length: 1 });
    expect(checkNickname('가'.repeat(13))).toMatchObject({ ok: false, length: 13 });
    const long = checkNickname('가'.repeat(13));
    expect(!long.ok && long.message).toContain('12자 이하');
  });

  it('허용하지 않는 문자', () => {
    for (const bad of ['새벽-감자', 'potato!', '감자😀', 'a.b', '감자@']) {
      const r = checkNickname(bad);
      expect(r.ok, bad).toBe(false);
      expect(!r.ok && r.message).toBe('한글 · 영문 · 숫자 · 밑줄(_) · 공백만 쓸 수 있어요.');
    }
  });

  it('한글 낱자(자모)는 따로 안내', () => {
    const r = checkNickname('ㄱㄱ감자');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('완성된 글자');
  });
});
