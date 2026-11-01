import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/client';
import { handleScrimMutationError } from './scrims';

describe('내전 변경 실패 처리', () => {
  const keys = (status: number, code: 'SCRIM_NOT_RECRUITING' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_FAILED') => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    handleScrimMutationError(qc, 'id', new ApiError(code, status, '오류'));
    return spy.mock.calls.map((c) => c[0]?.queryKey);
  };
  it.each([
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'SCRIM_NOT_RECRUITING'],
  ] as const)('%i: 상세·목록·홈 요약을 다시 받는다', (status, code) => {
    expect(keys(status, code)).toEqual(expect.arrayContaining([['scrims', 'detail', 'id'], ['scrims', 'list'], ['dashboard', 'summary']]));
  });
  it('400은 다시 받지 않는다', () => {
    expect(keys(400, 'VALIDATION_FAILED')).toEqual([]);
  });
});
