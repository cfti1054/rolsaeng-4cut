import type { Me } from '@gcd/shared';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { applySessionUser, queryKeys } from './auth';

const user = (id: string) => ({ id, nickname: id }) as Me;
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('세션 사용자 교체', () => {
  it('같은 사용자면 값을 지우지 않는다', () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.me, user('a'));
    qc.setQueryData(['dashboard', 'summary'], 'A의 요약');
    applySessionUser(qc, { ...user('a'), nickname: '새 이름' });
    expect(qc.getQueryData(['dashboard', 'summary'])).toBe('A의 요약');
    expect(qc.getQueryData<Me>(queryKeys.me)?.nickname).toBe('새 이름');
  });

  it('첫 세션은 지울 것이 없다', () => {
    const qc = new QueryClient();
    qc.setQueryData(['games'], 'games');
    applySessionUser(qc, user('a'));
    expect(qc.getQueryData(['games'])).toBe('games');
  });

  it('사용자가 바뀌면 안 보이는 쿼리는 비우고, 떠 있는 화면은 새 사용자 값으로 바뀐다', async () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.me, user('a'));
    qc.setQueryData(['rankings', 'elo', 'lol', 'default'], 'A의 me 행');
    let who = 'A의 요약';
    const screen = new QueryObserver(qc, { queryKey: ['dashboard', 'summary'], queryFn: async () => who, staleTime: 60_000 });
    const off = screen.subscribe(() => {});
    await tick();
    expect(screen.getCurrentResult().data).toBe('A의 요약');

    who = 'B의 요약';
    applySessionUser(qc, user('b'));
    expect(screen.getCurrentResult().data).toBeUndefined();
    expect(qc.getQueryData(['rankings', 'elo', 'lol', 'default'])).toBeUndefined();
    expect(qc.getQueryData<Me>(queryKeys.me)?.id).toBe('b');
    await tick();
    expect(screen.getCurrentResult().data).toBe('B의 요약');
    off();
  });
});
