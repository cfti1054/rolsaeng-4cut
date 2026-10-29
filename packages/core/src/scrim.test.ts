import { describe, expect, it } from 'vitest';
import {
  GAME_SEED,
  SCRIM_AUTO_CLOSE_AFTER_MIN_DEFAULT,
  SCRIM_SCHEDULE_MAX_DAYS_AHEAD_DEFAULT,
  type ScrimStatus,
} from '@gcd/shared';
import {
  canStartScrim,
  computeOpenPositions,
  decideOverdueScrim,
  isCapacityInRange,
  isJoinClosed,
  orderWaitlist,
  placeNewParticipant,
  planRosterAfterChange,
  statusForJoinedCount,
  validatePreferredPositions,
  validateScrimSchedule,
  type WaitlistRow,
} from './index';

const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;
const NOW = new Date('2026-10-29T12:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);
const LOL = ['top', 'jungle', 'mid', 'bot', 'support'];

const row = (id: string, offsetMs: number): WaitlistRow => ({ id, joinedAt: at(offsetMs) });

describe('orderWaitlist', () => {
  it('joinedAt 오름차순', () => {
    const rows = [row('c', 30), row('a', 10), row('b', 20)];
    expect(orderWaitlist(rows).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('joinedAt 같으면 id 문자열 오름차순(UUID)', () => {
    const rows = [
      row('9f000000-0000-4000-8000-000000000000', 0),
      row('0a000000-0000-4000-8000-000000000000', 0),
      row('5b000000-0000-4000-8000-000000000000', -1),
    ];
    expect(orderWaitlist(rows).map((r) => r.id.slice(0, 2))).toEqual(['5b', '0a', '9f']);
  });

  it('입력 배열 불변, 추가 필드 유지', () => {
    const rows = [{ ...row('b', 2), extra: 1 }, { ...row('a', 1), extra: 2 }];
    const out = orderWaitlist(rows);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
    expect(out[0]).toEqual({ id: 'a', joinedAt: at(1), extra: 2 });
    expect(out).not.toBe(rows);
  });

  it('빈 입력 → []', () => {
    expect(orderWaitlist([])).toEqual([]);
  });
});

describe('placeNewParticipant / statusForJoinedCount', () => {
  it('정원 마지막 자리: 9/10 → joined, 10/10 → waitlist', () => {
    expect(placeNewParticipant(9, 10)).toBe('joined');
    expect(placeNewParticipant(10, 10)).toBe('waitlist');
    expect(placeNewParticipant(0, 2)).toBe('joined');
  });

  it('joined 수 ≥ 정원 → full', () => {
    expect(statusForJoinedCount(9, 10)).toBe('recruiting');
    expect(statusForJoinedCount(10, 10)).toBe('full');
    expect(statusForJoinedCount(11, 10)).toBe('full');
  });
});

describe('planRosterAfterChange', () => {
  const waitlist = [row('w3', 30), row('w1', 10), row('w2', 20)];

  it('취소로 1자리 → 대기 1번 승격, 다시 full', () => {
    expect(planRosterAfterChange({ capacity: 10, joinedCount: 9, waitlist })).toEqual({
      promoteIds: ['w1'],
      nextStatus: 'full',
    });
  });

  it('대기열 없음 → 승격 없음, recruiting', () => {
    expect(planRosterAfterChange({ capacity: 10, joinedCount: 9, waitlist: [] })).toEqual({
      promoteIds: [],
      nextStatus: 'recruiting',
    });
  });

  it('정원 확대로 빈 자리 > 대기 수 → 전원 승격, recruiting', () => {
    expect(planRosterAfterChange({ capacity: 8, joinedCount: 4, waitlist })).toEqual({
      promoteIds: ['w1', 'w2', 'w3'],
      nextStatus: 'recruiting',
    });
  });

  it('빈 자리 2, 대기 3 → 앞 2명, full', () => {
    expect(planRosterAfterChange({ capacity: 6, joinedCount: 4, waitlist })).toEqual({
      promoteIds: ['w1', 'w2'],
      nextStatus: 'full',
    });
  });

  it('꽉 찬 상태 그대로 → 승격 없음, full', () => {
    expect(planRosterAfterChange({ capacity: 4, joinedCount: 4, waitlist })).toEqual({
      promoteIds: [],
      nextStatus: 'full',
    });
  });

  it('대기 순서는 joinedAt 동률이면 id', () => {
    const tie = [row('b', 0), row('a', 0)];
    expect(planRosterAfterChange({ capacity: 3, joinedCount: 2, waitlist: tie }).promoteIds).toEqual(['a']);
  });

  it('joinedCount > capacity → RangeError(D79)', () => {
    expect(() => planRosterAfterChange({ capacity: 4, joinedCount: 5, waitlist: [] })).toThrow(RangeError);
  });

  it('음수·소수 → RangeError', () => {
    expect(() => planRosterAfterChange({ capacity: 4, joinedCount: -1, waitlist: [] })).toThrow(RangeError);
    expect(() => planRosterAfterChange({ capacity: 4.5, joinedCount: 1, waitlist: [] })).toThrow(RangeError);
  });

  it('입력 대기열을 바꾸지 않는다', () => {
    const wl = [row('b', 2), row('a', 1)];
    planRosterAfterChange({ capacity: 3, joinedCount: 1, waitlist: wl });
    expect(wl.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('validatePreferredPositions', () => {
  it('포지션 게임: 1지망만·1지망+2지망 허용', () => {
    expect(validatePreferredPositions(['mid'], LOL, true)).toEqual({ ok: true });
    expect(validatePreferredPositions(['mid', 'support'], LOL, true)).toEqual({ ok: true });
  });

  it('포지션 게임: 빈 배열(1지망 누락) 거부', () => {
    expect(validatePreferredPositions([], LOL, true).ok).toBe(false);
  });

  it('포지션 게임: 3개 거부', () => {
    expect(validatePreferredPositions(['top', 'mid', 'bot'], LOL, true).ok).toBe(false);
  });

  it('포지션 게임: 1지망 = 2지망 중복 거부', () => {
    const r = validatePreferredPositions(['mid', 'mid'], LOL, true);
    expect(r.ok).toBe(false);
  });

  it('포지션 게임: 범위 밖 값 거부(1지망·2지망 모두)', () => {
    expect(validatePreferredPositions(['adc'], LOL, true).ok).toBe(false);
    expect(validatePreferredPositions(['mid', 'adc'], LOL, true).ok).toBe(false);
  });

  it('실패 시 message가 있다', () => {
    const r = validatePreferredPositions(['adc'], LOL, true);
    expect(r.ok === false && r.message.length > 0).toBe(true);
  });

  it('포지션 없는 게임(롤체)·use_positions 끈 내전: [] 만 허용', () => {
    expect(validatePreferredPositions([], [], false)).toEqual({ ok: true });
    expect(validatePreferredPositions(['mid'], [], false).ok).toBe(false);
    expect(validatePreferredPositions([], LOL, false)).toEqual({ ok: true });
    expect(validatePreferredPositions(['mid'], LOL, false).ok).toBe(false);
  });
});

describe('validateScrimSchedule', () => {
  const max = SCRIM_SCHEDULE_MAX_DAYS_AHEAD_DEFAULT;
  it('기본 상한 30일', () => expect(max).toBe(30));
  it('시작 시각 = now → not_future, 과거 → not_future', () => {
    expect(validateScrimSchedule(NOW, NOW, max)).toBe('not_future');
    expect(validateScrimSchedule(at(-1), NOW, max)).toBe('not_future');
  });
  it('now + 1ms → ok', () => expect(validateScrimSchedule(at(1), NOW, max)).toBe('ok'));
  it('정확히 30일 → ok, 30일 + 1ms → too_far', () => {
    expect(validateScrimSchedule(at(30 * DAY), NOW, max)).toBe('ok');
    expect(validateScrimSchedule(at(30 * DAY + 1), NOW, max)).toBe('too_far');
  });
  it('잘못된 Date → RangeError', () => {
    expect(() => validateScrimSchedule(new Date('x'), NOW, max)).toThrow(RangeError);
  });
});

describe('isCapacityInRange', () => {
  it('경계 포함, 범위 밖·소수 거부', () => {
    const r = { min: 2, max: 8 };
    expect(isCapacityInRange(2, r)).toBe(true);
    expect(isCapacityInRange(8, r)).toBe(true);
    expect(isCapacityInRange(1, r)).toBe(false);
    expect(isCapacityInRange(9, r)).toBe(false);
    expect(isCapacityInRange(4.5, r)).toBe(false);
    expect(isCapacityInRange(Number.NaN, r)).toBe(false);
  });
  it('롤 정원 2–10 짝수만(GAME_SEED)', () => {
    const lol = GAME_SEED.find((g) => g.code === 'lol')!;
    const r = { min: lol.capacity_min, max: lol.capacity_max, step: lol.capacity_step };
    for (const ok of [2, 4, 6, 8, 10]) expect(isCapacityInRange(ok, r)).toBe(true);
    for (const bad of [0, 1, 3, 5, 7, 9, 11, 12]) expect(isCapacityInRange(bad, r)).toBe(false);
  });
  it('step은 min 기준: min 3, step 2 → 3·5·7', () => {
    const r = { min: 3, max: 7, step: 2 };
    expect([3, 4, 5, 6, 7].map((c) => isCapacityInRange(c, r))).toEqual([true, false, true, false, true]);
  });
  it('GAME_SEED 기본 정원은 모두 허용 값', () => {
    for (const g of GAME_SEED) {
      expect(isCapacityInRange(g.capacity_default, { min: g.capacity_min, max: g.capacity_max, step: g.capacity_step })).toBe(true);
      expect(isCapacityInRange(g.capacity_max, { min: g.capacity_min, max: g.capacity_max, step: g.capacity_step })).toBe(true);
    }
  });
});

describe('canStartScrim', () => {
  it('꽉 차야 시작: 9/10·5/6 불가, 10/10·6/6 가능', () => {
    expect(canStartScrim({ requiresFull: true, capacity: 10, joinedCount: 9 })).toBe(false);
    expect(canStartScrim({ requiresFull: true, capacity: 10, joinedCount: 10 })).toBe(true);
    expect(canStartScrim({ requiresFull: true, capacity: 6, joinedCount: 5 })).toBe(false);
    expect(canStartScrim({ requiresFull: true, capacity: 6, joinedCount: 6 })).toBe(true);
  });
  it('그 외: 1명 불가, 2명 가능(정원 미달이어도)', () => {
    expect(canStartScrim({ requiresFull: false, capacity: 8, joinedCount: 1 })).toBe(false);
    expect(canStartScrim({ requiresFull: false, capacity: 8, joinedCount: 2 })).toBe(true);
    expect(canStartScrim({ requiresFull: false, capacity: 8, joinedCount: 8 })).toBe(true);
  });
});

describe('decideOverdueScrim', () => {
  const scheduledAt = NOW;
  const base = {
    scheduledAt,
    autoCloseAfterMin: SCRIM_AUTO_CLOSE_AFTER_MIN_DEFAULT,
  };
  it('기본 60분', () => expect(SCRIM_AUTO_CLOSE_AFTER_MIN_DEFAULT).toBe(60));

  it('정확히 60분 → 처리, 1ms 전 → null', () => {
    expect(decideOverdueScrim({ ...base, status: 'recruiting', now: at(60 * MIN), canStart: true })).toBe('start');
    expect(decideOverdueScrim({ ...base, status: 'recruiting', now: at(60 * MIN - 1), canStart: true })).toBeNull();
  });

  it('canStart false → cancel, full도 대상', () => {
    expect(decideOverdueScrim({ ...base, status: 'recruiting', now: at(61 * MIN), canStart: false })).toBe('cancel');
    expect(decideOverdueScrim({ ...base, status: 'full', now: at(61 * MIN), canStart: true })).toBe('start');
  });

  it('모집 중이 아니면 null(그사이 시작·취소·종료)', () => {
    for (const status of ['playing', 'finished', 'cancelled'] as ScrimStatus[]) {
      expect(decideOverdueScrim({ ...base, status, now: at(DAY), canStart: true })).toBeNull();
    }
  });

  it('시작 시각을 미룬 뒤(scheduledAt 미래) → null', () => {
    expect(
      decideOverdueScrim({ ...base, scheduledAt: at(DAY), status: 'recruiting', now: at(2 * 60 * MIN), canStart: true }),
    ).toBeNull();
  });
});

describe('computeOpenPositions', () => {
  it('롤 10명: 포지션당 2자리, 1지망 수만큼 뺀다(positions 순서)', () => {
    const first = ['top', 'top', 'jungle', 'mid', 'mid', 'bot', 'bot', 'support'];
    expect(computeOpenPositions(LOL, 10, first)).toEqual([
      { position: 'jungle', count: 1 },
      { position: 'support', count: 1 },
    ]);
  });

  it('방장 1명뿐 → 4개 포지션 2자리 + 방장 포지션 1자리', () => {
    expect(computeOpenPositions(LOL, 10, ['mid'])).toEqual([
      { position: 'top', count: 2 },
      { position: 'jungle', count: 2 },
      { position: 'mid', count: 1 },
      { position: 'bot', count: 2 },
      { position: 'support', count: 2 },
    ]);
  });

  it('1지망 쏠림: 미드 3명 → 미드는 음수라 제외, 나머지 2자리', () => {
    const r = computeOpenPositions(LOL, 10, ['mid', 'mid', 'mid']);
    expect(r.find((p) => p.position === 'mid')).toBeUndefined();
    expect(r).toHaveLength(4);
    expect(r.every((p) => p.count === 2)).toBe(true);
  });

  it('빈 자리 0(정원 마지막 자리까지 참) → []', () => {
    expect(computeOpenPositions(LOL, 10, Array(10).fill('mid'))).toEqual([]);
  });

  it('정원 초과 입력도 [] ', () => {
    expect(computeOpenPositions(LOL, 10, Array(11).fill('top'))).toEqual([]);
  });

  it('나누어떨어지지 않는 정원 → []', () => {
    expect(computeOpenPositions(LOL, 8, ['mid'])).toEqual([]);
  });

  it('포지션 없는 게임 → []', () => {
    expect(computeOpenPositions([], 8, [null, null])).toEqual([]);
  });

  it('1지망 null·게임에 없는 값은 자리 수에만 반영', () => {
    expect(computeOpenPositions(LOL, 5, [null, 'adc', 'top'])).toEqual([
      { position: 'jungle', count: 1 },
      { position: 'mid', count: 1 },
      { position: 'bot', count: 1 },
      { position: 'support', count: 1 },
    ]);
  });
});

describe('isJoinClosed', () => {
  it('now = 시작 시각이면 마감, 1ms 전이면 열림', () => {
    expect(isJoinClosed(NOW, NOW)).toBe(true);
    expect(isJoinClosed(NOW, at(-1))).toBe(false);
    expect(isJoinClosed(NOW, at(1))).toBe(true);
  });
});
