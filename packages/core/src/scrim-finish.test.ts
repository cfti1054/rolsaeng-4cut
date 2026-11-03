import { describe, expect, it } from 'vitest';
import { canFinishScrim, isAutoFinishDue } from './scrim-finish';

const START = new Date('2026-11-03T10:00:00.000Z');
const at = (min: number) => new Date(START.getTime() + min * 60_000);
const base = { status: 'playing', startedAt: START, noResult: true, hasPendingResult: false };

describe('결과 없는 모집 종료 규칙', () => {
  it('방장은 시작 직후에도 종료할 수 있다', () => {
    expect(canFinishScrim({ ...base, now: at(1), isHost: true, isAdmin: false })).toBe(true);
  });
  it('운영진은 6시간 전에는 못 끝내고, 6시간이 되면 끝낼 수 있다', () => {
    expect(canFinishScrim({ ...base, now: at(359), isHost: false, isAdmin: true })).toBe(false);
    expect(canFinishScrim({ ...base, now: at(360), isHost: false, isAdmin: true })).toBe(true);
  });
  it('방장도 운영진도 아니면 끝낼 수 없다', () => {
    expect(canFinishScrim({ ...base, now: at(1000), isHost: false, isAdmin: false })).toBe(false);
  });
  it('내전(결과 입력 대상)·승인 대기 결과·시작 전·playing이 아니면 끝낼 수 없다', () => {
    expect(canFinishScrim({ ...base, noResult: false, now: at(600), isHost: true, isAdmin: true })).toBe(false);
    expect(canFinishScrim({ ...base, hasPendingResult: true, now: at(600), isHost: true, isAdmin: true })).toBe(false);
    expect(canFinishScrim({ ...base, startedAt: null, now: at(600), isHost: true, isAdmin: true })).toBe(false);
    expect(canFinishScrim({ ...base, status: 'finished', now: at(600), isHost: true, isAdmin: true })).toBe(false);
  });
  it('시작 24시간 뒤부터 자동 종료 대상이다', () => {
    expect(isAutoFinishDue({ ...base, now: at(1439) })).toBe(false);
    expect(isAutoFinishDue({ ...base, now: at(1440) })).toBe(true);
    expect(isAutoFinishDue({ ...base, noResult: false, now: at(1440) })).toBe(false);
    expect(isAutoFinishDue({ ...base, hasPendingResult: true, now: at(1440) })).toBe(false);
  });
});
