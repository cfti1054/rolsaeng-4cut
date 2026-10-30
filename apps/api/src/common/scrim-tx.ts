import type { Prisma } from '@prisma/client';

/**
 * 내전 쓰기 트랜잭션 공통 옵션(S3 QA minor 2).
 * Prisma 대화형 트랜잭션 기본값(timeout 5초, maxWait 2초)은 내전 행 잠금(FOR UPDATE)·사용자 레이팅 advisory 잠금 대기까지
 * timeout에 포함해서, 같은 내전에 요청이 몰리거나 16명 승인(쿼리 약 50개)이 사용자 잠금을 기다리면 P2028(500)로 끝날 수 있다.
 * - timeout 15초: 트랜잭션 시작부터 커밋까지 상한(잠금 대기 포함). 승인 시즌 판정의 여유 시간(margin)으로도 쓴다
 * - maxWait 5초: 커넥션 풀에서 트랜잭션 커넥션을 얻을 때까지 상한
 */
export const SCRIM_TX_TIMEOUT_MS = 15_000;
export const SCRIM_TX_MAX_WAIT_MS = 5_000;

type TxRunner = {
  $transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
};

/** 내전 행 잠금 경로(S2 7개 + S3 5개 + 자동 마감 건별)의 트랜잭션 */
export function scrimWriteTx<T>(
  prisma: TxRunner,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { isolationLevel?: Prisma.TransactionIsolationLevel } = {},
): Promise<T> {
  return prisma.$transaction(fn, { timeout: SCRIM_TX_TIMEOUT_MS, maxWait: SCRIM_TX_MAX_WAIT_MS, ...options });
}
