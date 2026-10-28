import { describe, expect, it } from 'vitest';
import {
  ERROR_HTTP_STATUS,
  ErrorBody,
  ErrorCode,
  GAME_SEED,
  GameCode,
  Nickname,
  PaginationQuery,
  SafeRedirectPath,
  SCRIM_STATUS_TRANSITIONS,
  UpdateMeRequest,
  canTransition,
  normalizeNickname,
  paginated,
} from './index';
import { z } from 'zod';

describe('errors', () => {
  it('모든 ErrorCode에 HTTP 상태가 있다', () => {
    for (const code of ErrorCode.options) {
      expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
  });
  it('ErrorBody는 {code, message} 형식', () => {
    expect(ErrorBody.parse({ code: 'NOT_FOUND', message: 'x' })).toEqual({ code: 'NOT_FOUND', message: 'x' });
    expect(() => ErrorBody.parse({ code: 'UNKNOWN', message: 'x' })).toThrow();
  });
});

describe('pagination', () => {
  it('limit 기본 20, 최대 100', () => {
    expect(PaginationQuery.parse({}).limit).toBe(20);
    expect(PaginationQuery.parse({ limit: '50' }).limit).toBe(50);
    expect(() => PaginationQuery.parse({ limit: '101' })).toThrow();
    expect(() => PaginationQuery.parse({ limit: '0' })).toThrow();
  });
  it('목록 응답은 { items, next_cursor }', () => {
    const S = paginated(z.object({ id: z.string() }));
    expect(S.parse({ items: [{ id: 'a' }], next_cursor: null }).next_cursor).toBeNull();
    expect(() => S.parse([{ id: 'a' }])).toThrow();
  });
});

describe('nickname', () => {
  it('2–12자 한글·영문·숫자·밑줄·공백, 앞뒤 공백 제거·연속 공백 1개로 정규화', () => {
    expect(Nickname.parse('  새벽감자 ')).toBe('새벽감자');
    expect(Nickname.parse('mid_01')).toBe('mid_01');
    expect(Nickname.parse('새벽 감자')).toBe('새벽 감자');
    expect(Nickname.parse('새벽   감자')).toBe('새벽 감자');
    expect(Nickname.parse('새벽\t감자')).toBe('새벽 감자');
    expect(normalizeNickname('  a   b  ')).toBe('a b');
    expect(Nickname.parse('열두글자열두글자열두글자')).toHaveLength(12);
    expect(() => Nickname.parse('a')).toThrow();
    expect(() => Nickname.parse(' a   ')).toThrow();
    expect(() => Nickname.parse('열세글자열세글자열세글자열')).toThrow();
    expect(() => Nickname.parse('ㅋㅋ')).toThrow();
    expect(() => Nickname.parse('감자!')).toThrow();
  });
  it('PATCH /me는 알 수 없는 필드를 거절', () => {
    expect(() => UpdateMeRequest.parse({ nickname: '새벽감자', role: 'admin' })).toThrow();
  });
});

describe('redirect', () => {
  it('웹 내부 경로만 허용', () => {
    expect(SafeRedirectPath.parse('/scrims/1?tab=a')).toBe('/scrims/1?tab=a');
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'scrims', '/a b']) {
      expect(() => SafeRedirectPath.parse(bad)).toThrow();
    }
  });
});

describe('games & transitions', () => {
  it('GAME_SEED 코드와 GameCode enum이 일치', () => {
    expect(GAME_SEED.map((g) => g.code).sort()).toEqual([...GameCode.options].sort());
    for (const g of GAME_SEED) expect(g.has_positions).toBe(g.positions.length > 0);
  });
  it('scrims 전이 맵', () => {
    expect(canTransition(SCRIM_STATUS_TRANSITIONS, 'recruiting', 'full')).toBe(true);
    expect(canTransition(SCRIM_STATUS_TRANSITIONS, 'finished', 'recruiting')).toBe(false);
  });
});
