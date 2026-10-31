import type { ScrimStatus } from '@gcd/shared';

/**
 * 내전 행 잠금(계약 S2 5-0, D85). 명단·상태를 바꾸는 모든 경로(참가·취소·수정·시작·모집 취소·노쇼 표시·자동 마감)는
 * 트랜잭션의 첫 문장으로 이것을 부른다. 같은 내전의 동시 요청이 여기서 직렬화되고, READ COMMITTED에서
 * 잠금을 얻은 뒤의 문장은 앞 트랜잭션이 커밋한 참가자 행을 본다.
 */
export type RawQueryExecutor = {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
};

export type LockedScrim = {
  id: string;
  status: ScrimStatus;
  capacity: number;
  scheduledAt: Date;
  hostId: string;
  usePositions: boolean;
  gameId: string;
  autoBalance: boolean;
  tftMode: 'double_up' | 'normal' | 'ranked' | null;
};

type LockedRow = {
  id: string;
  status: ScrimStatus;
  capacity: number;
  scheduled_at: Date;
  host_id: string;
  use_positions: boolean;
  game_id: string;
  auto_balance: boolean;
  tft_mode: 'double_up' | 'normal' | 'ranked' | null;
};

/** 없으면 null(호출자가 NOT_FOUND). id는 컨트롤러에서 UUID 검증을 거친 값 */
export async function lockScrim(tx: RawQueryExecutor, id: string): Promise<LockedScrim | null> {
  const rows = await tx.$queryRaw<LockedRow[]>`
    SELECT id::text AS id, status::text AS status, capacity, scheduled_at, host_id::text AS host_id, use_positions, game_id::text AS game_id,
           auto_balance, tft_mode::text AS tft_mode
    FROM scrims WHERE id = ${id}::uuid FOR UPDATE`;
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    status: r.status,
    capacity: Number(r.capacity),
    scheduledAt: r.scheduled_at,
    hostId: r.host_id,
    usePositions: r.use_positions,
    gameId: r.game_id,
    autoBalance: r.auto_balance,
    tftMode: r.tft_mode,
  };
}
