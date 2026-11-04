import { describe, expect, it } from 'vitest';
import { randomTeamSplit } from './balance';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`);

describe('randomTeamSplit (솔랭내기 랜덤 팀)', () => {
  it('두 팀이 전원을 한 번씩 나눠 갖고, 블루는 floor(n/2)명', () => {
    for (const n of [2, 3, 6, 9, 10]) {
      const r = randomTeamSplit(ids(n), Math.random);
      expect(r.blue).toHaveLength(Math.floor(n / 2));
      expect([...r.blue, ...r.orange].sort()).toEqual(ids(n).sort());
    }
  });

  it('같은 난수열이면 같은 결과이고, 입력 배열은 바꾸지 않는다', () => {
    const input = ids(10);
    const seq = [0.1, 0.9, 0.5, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6];
    const run = () => {
      let i = 0;
      return randomTeamSplit(input, () => seq[i++]!);
    };
    expect(run()).toEqual(run());
    expect(input).toEqual(ids(10));
  });

  it('인원 범위를 벗어나면 RangeError', () => {
    expect(() => randomTeamSplit(ids(1), Math.random)).toThrow(RangeError);
    expect(() => randomTeamSplit(ids(17), Math.random)).toThrow(RangeError);
  });
});
