import { describe, expect, it } from 'vitest';
import { MainPosition, type LolPosition } from '@gcd/shared';
import { computeMainPosition } from './index';

const rep = (p: LolPosition | null, n: number): (LolPosition | null)[] => Array.from({ length: n }, () => p);

describe('computeMainPosition', () => {
  it('빈 입력(경기 0건) → null', () => {
    expect(computeMainPosition([])).toBeNull();
  });

  it('포지션 전부 null → null', () => {
    expect(computeMainPosition(rep(null, 5))).toBeNull();
  });

  it('한 포지션만 → 1개, ratio 1', () => {
    const r = computeMainPosition(['mid', 'mid', 'mid']);
    expect(r).toEqual({ source: 'riot_ranked_solo', sample_size: 3, positions: [{ position: 'mid', count: 3, ratio: 1 }] });
    expect(MainPosition.parse(r)).toEqual(r);
  });

  it('경기 수 내림차순 최대 2개', () => {
    const r = computeMainPosition([...rep('support', 2), ...rep('jungle', 5), ...rep('top', 3)]);
    expect(r?.sample_size).toBe(10);
    expect(r?.positions).toEqual([
      { position: 'jungle', count: 5, ratio: 0.5 },
      { position: 'top', count: 3, ratio: 0.3 },
    ]);
  });

  it('동률은 LolPosition 순서(top, jungle, mid, bot, support)', () => {
    const r = computeMainPosition(['support', 'bot', 'mid', 'support', 'bot', 'mid']);
    expect(r?.positions.map((p) => p.position)).toEqual(['mid', 'bot']);
    expect(r?.positions.map((p) => p.ratio)).toEqual([0.33, 0.33]);
  });

  it('1위 동률이 아니고 2위가 동률이면 2위는 순서가 앞선 것', () => {
    const r = computeMainPosition(['support', 'support', 'support', 'bot', 'top']);
    expect(r?.positions.map((p) => p.position)).toEqual(['support', 'top']);
  });

  it('5포지션 모두 1경기씩 → top, jungle', () => {
    const r = computeMainPosition(['support', 'bot', 'mid', 'jungle', 'top']);
    expect(r?.positions).toEqual([
      { position: 'top', count: 1, ratio: 0.2 },
      { position: 'jungle', count: 1, ratio: 0.2 },
    ]);
  });

  it('null은 sample_size에서 빠지고 ratio 분모도 null 제외 수', () => {
    const r = computeMainPosition(['bot', null, 'bot', null, 'support']);
    expect(r?.sample_size).toBe(3);
    expect(r?.positions).toEqual([
      { position: 'bot', count: 2, ratio: 0.67 },
      { position: 'support', count: 1, ratio: 0.33 },
    ]);
  });

  it('앞(최신) 20개만 본다: 21번째 이후는 무시', () => {
    const r = computeMainPosition([...rep('mid', 20), ...rep('top', 30)]);
    expect(r).toEqual({ source: 'riot_ranked_solo', sample_size: 20, positions: [{ position: 'mid', count: 20, ratio: 1 }] });
  });

  it('20개 창에는 null도 포함된다(null 때문에 21번째가 들어오지 않음)', () => {
    const r = computeMainPosition([...rep(null, 19), 'jungle', 'top', 'top']);
    expect(r?.sample_size).toBe(1);
    expect(r?.positions).toEqual([{ position: 'jungle', count: 1, ratio: 1 }]);
  });

  it('앞 20개가 전부 null이면 그 뒤가 있어도 null', () => {
    expect(computeMainPosition([...rep(null, 20), 'mid'])).toBeNull();
  });

  it('반올림: 1/3 → 0.33, 2/3 → 0.67, 1/8 → 0.13, 7/20 → 0.35', () => {
    expect(computeMainPosition(['top', 'mid', 'mid'])?.positions.map((p) => p.ratio)).toEqual([0.67, 0.33]);
    expect(computeMainPosition([...rep('bot', 7), 'top'])?.positions.map((p) => p.ratio)).toEqual([0.88, 0.13]);
    expect(computeMainPosition([...rep('mid', 7), ...rep('top', 13)])?.positions.map((p) => p.ratio)).toEqual([0.65, 0.35]);
  });

  it('출력은 shared MainPosition 스키마를 통과한다(무작위 입력 다수)', () => {
    const all: (LolPosition | null)[] = ['top', 'jungle', 'mid', 'bot', 'support', null];
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let t = 0; t < 200; t++) {
      const len = Math.floor(rnd() * 30);
      const input = Array.from({ length: len }, () => all[Math.floor(rnd() * all.length)] ?? null);
      const r = computeMainPosition(input);
      const nonNull = input.slice(0, 20).filter((p) => p !== null).length;
      if (nonNull === 0) {
        expect(r).toBeNull();
      } else {
        expect(MainPosition.parse(r)).toEqual(r);
        expect(r?.sample_size).toBe(nonNull);
        const counts = r?.positions.map((p) => p.count) ?? [];
        expect([...counts].sort((a, b) => b - a)).toEqual(counts);
      }
    }
  });

  it('입력 배열을 바꾸지 않는다', () => {
    const input: (LolPosition | null)[] = ['bot', null, 'top'];
    const copy = [...input];
    computeMainPosition(input);
    expect(input).toEqual(copy);
  });

  it('모르는 포지션 문자열 → RangeError', () => {
    expect(() => computeMainPosition(['mid', 'adc' as LolPosition])).toThrow(RangeError);
  });
});
