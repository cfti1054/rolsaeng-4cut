/**
 * PostgreSQL 트랜잭션 advisory lock(계약 S1 5-1 5단계, 7절 2단계).
 * 트랜잭션이 끝나면 자동으로 풀린다(D62와 같은 이유로 세션 잠금은 쓰지 않는다).
 *
 * - `game-accounts:{user_id}`: 연동(라이엇 확인·스팀 콜백)·해제·대표 지정이 공유. 라이엇 ID 개수·대표 1개 보장
 * - `sync-quota:{user_id}`: 수동 새로고침 횟수 검사·차감 직렬화
 */
export type RawExecutor = {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<number>;
};

export const userGameAccountsLockKey = (userId: string): string => `game-accounts:${userId}`;
export const userSyncQuotaLockKey = (userId: string): string => `sync-quota:${userId}`;

export async function advisoryXactLock(tx: RawExecutor, key: string): Promise<void> {
  // pg_advisory_xact_lock은 void를 돌려주므로 $queryRaw가 아니라 $executeRaw로 실행한다
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}
