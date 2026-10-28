import { Nickname, normalizeNickname } from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import {
  deriveDefaultNickname,
  discordFallbackNickname,
  sanitizeNicknameCandidate,
} from './default-nickname';

const none = async () => false;
const takenSet = (s: Set<string>) => async (n: string) => s.has(n);

function assertValid(n: string) {
  expect(Nickname.safeParse(n).success).toBe(true);
  expect(normalizeNickname(n)).toBe(n);
}

describe('sanitizeNicknameCandidate', () => {
  it.each([
    ['서버닉', '서버닉'],
    ['  Kim  the   Gamer  ', 'Kim the Gamer'.slice(0, 12).trim()],
    ['★별★빛★', '별빛'],
    ['a', null],
    ['!!', null],
    ['', null],
    [null, null],
    ['abcdefghijklmnopq', 'abcdefghijkl'],
    // 12자에서 잘린 끝 공백은 제거
    ['abcdefghijk lmn', 'abcdefghijk'],
    ['탭\t\n줄바꿈', '탭 줄바꿈'],
    ['ㄱㄴㄷ자모', '자모'], // 완성형만
  ])('%j → %j', (input, expected) => {
    const out = sanitizeNicknameCandidate(input);
    expect(out).toBe(expected);
    if (out) assertValid(out);
  });
});

describe('deriveDefaultNickname', () => {
  it('후보 순서: 길드 nick → global_name → username', async () => {
    expect(await deriveDefaultNickname({ candidates: ['서버닉', '글로벌', 'user_name'], fallback: 'user1234', isTaken: none })).toBe('서버닉');
    expect(await deriveDefaultNickname({ candidates: [null, '글로벌', 'user_name'], fallback: 'user1234', isTaken: none })).toBe('글로벌');
    expect(await deriveDefaultNickname({ candidates: ['💀', '!', 'user_name'], fallback: 'user1234', isTaken: none })).toBe('user_name');
  });

  it('모든 후보 실패 → fallback', async () => {
    expect(await deriveDefaultNickname({ candidates: ['💀', null, '.'], fallback: 'user5678', isTaken: none })).toBe('user5678');
    expect(discordFallbackNickname('123456789012345678')).toBe('user5678');
  });

  it('중복이면 (앞 10자 trimEnd) + 2..99', async () => {
    const taken = new Set(['서버닉']);
    expect(await deriveDefaultNickname({ candidates: ['서버닉'], fallback: 'x', isTaken: takenSet(taken) })).toBe('서버닉2');
    taken.add('서버닉2');
    expect(await deriveDefaultNickname({ candidates: ['서버닉'], fallback: 'x', isTaken: takenSet(taken) })).toBe('서버닉3');
  });

  it('긴 이름은 앞 10자를 trimEnd 하고 숫자를 붙여 12자 이하', async () => {
    const base = 'abcdefghi jkl'; // 정규화 후 12자로 자르면 'abcdefghi jk'
    const taken = new Set(['abcdefghi jk']);
    const out = await deriveDefaultNickname({ candidates: [base], fallback: 'x', isTaken: takenSet(taken) });
    expect(out).toBe('abcdefghi2'); // 앞 10자 'abcdefghi ' → trimEnd → 'abcdefghi' + '2'
    assertValid(out);
  });

  it('2..99 모두 겹치면 (앞 8자 trimEnd) + 난수 4자리', async () => {
    const isTaken = async (n: string) => n === 'longnickname' || /^longnickna\d+$/.test(n);
    const out = await deriveDefaultNickname({
      candidates: ['longnickname'],
      fallback: 'x',
      isTaken,
      random4: () => '0420',
    });
    expect(out).toBe('longnick0420');
    assertValid(out);
  });

  it('후보가 끝까지 소진되면 예외', async () => {
    await expect(
      deriveDefaultNickname({ candidates: ['ab'], fallback: 'x', isTaken: async () => true, random4: () => '0000', maxRandomAttempts: 3 }),
    ).rejects.toThrow();
  });

  it('결과는 항상 Nickname 통과 + 정규화 상태(무작위 입력)', async () => {
    const alphabet = ['a', 'Z', '9', '_', ' ', '\t', '가', '힣', '!', '😀', 'ㄱ', '-'];
    for (let i = 0; i < 300; i += 1) {
      const len = 1 + (i % 20);
      let s = '';
      for (let j = 0; j < len; j += 1) s += alphabet[(i * 7 + j * 13) % alphabet.length];
      const taken = new Set<string>();
      const first = await deriveDefaultNickname({ candidates: [s], fallback: 'user0001', isTaken: takenSet(taken) });
      assertValid(first);
      taken.add(first);
      const second = await deriveDefaultNickname({ candidates: [s], fallback: 'user0001', isTaken: takenSet(taken) });
      assertValid(second);
      expect(second).not.toBe(first);
    }
  });
});
