import type { GetMyGameAccountsResponse, SetPrimaryGameAccountResponse } from '@gcd/shared';
import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/client';
import { applyPrimary } from '@/lib/game-accounts';
import { listResponse, riotPair } from '@/lib/test-fixtures';
import { gameAccountKeys, setPrimaryMutationOptions } from './game-accounts';

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const main = riotPair('main#1', { is_primary: true, verified_at: '2026-10-01T00:00:00.000Z' });
  const sub = riotPair('sub#1', { verified_at: '2026-10-02T00:00:00.000Z' });
  const data = listResponse([...main, ...sub]);
  qc.setQueryData(gameAccountKeys.mine, data);
  const read = () => qc.getQueryData<GetMyGameAccountsResponse>(gameAccountKeys.mine)!;
  const primaryNames = () => read().accounts.filter((a) => a.is_primary).map((a) => a.display_name);
  return { qc, data, sub, read, primaryNames };
}

describe('대표 지정 뮤테이션(낙관적 갱신·롤백)', () => {
  it('요청 중에는 바로 대상이 대표로 보이고, 성공하면 서버 응답으로 맞춘다', async () => {
    const { qc, data, sub, primaryNames } = setup();
    let resolve!: (r: SetPrimaryGameAccountResponse) => void;
    const obs = new MutationObserver(
      qc,
      setPrimaryMutationOptions(qc, () => new Promise((r) => (resolve = r))),
    );
    const p = obs.mutate(sub[0].id);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(primaryNames()).toEqual(['sub#1', 'sub#1']);

    resolve({ accounts: applyPrimary(data, sub[0].id).accounts });
    await p;
    expect(primaryNames()).toEqual(['sub#1', 'sub#1']);
  });

  it('실패하면 이전 목록으로 되돌린다', async () => {
    const { qc, data, sub, read, primaryNames } = setup();
    let reject!: (e: unknown) => void;
    const obs = new MutationObserver(
      qc,
      setPrimaryMutationOptions(qc, () => new Promise((_, r) => (reject = r))),
    );
    const p = obs.mutate(sub[1].id).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 0));
    expect(primaryNames()).toEqual(['sub#1', 'sub#1']);

    reject(new ApiError('NOT_FOUND', 404, 'gone'));
    const err = await p;
    expect(err).toBeInstanceOf(ApiError);
    expect(primaryNames()).toEqual(['main#1', 'main#1']);
    expect(read()).toEqual(data);
  });
});
