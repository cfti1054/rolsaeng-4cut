import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

/**
 * fake-prisma용 일반 인메모리 테이블(S1 모델: games, game_accounts, riot_link_verifications,
 * game_account_sync_requests, rank_snapshots, recent_matches, steam_playtime).
 *
 * 지원하는 where: 필드 = 값/null/Date, { equals, in, notIn, not, gt, gte, lt, lte }, AND/OR/NOT.
 * 관계 필터(예: game: { code })는 지원하지 않는다(예외). data의 { increment } 지원. select·include는 무시.
 * 고유 제약은 문이 끝날 때 검사하고(PostgreSQL 비지연 제약과 같게 문 단위), 위반 시 그 문을 되돌리고 P2002를 던진다.
 */
export type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

function cmp(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function eq(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function matchField(v: unknown, cond: unknown): boolean {
  if (cond === null || typeof cond !== 'object' || cond instanceof Date) return cond === null ? v === null || v === undefined : eq(v, cond);
  const c = cond as Record<string, unknown>;
  for (const [op, arg] of Object.entries(c)) {
    switch (op) {
      case 'equals':
        if (!matchField(v, arg)) return false;
        break;
      case 'in':
        if (!(arg as unknown[]).some((a) => eq(v, a))) return false;
        break;
      case 'notIn':
        if ((arg as unknown[]).some((a) => eq(v, a))) return false;
        break;
      case 'not':
        if (matchField(v, arg)) return false;
        break;
      case 'gt':
        if (v === null || v === undefined || cmp(v, arg) <= 0) return false;
        break;
      case 'gte':
        if (v === null || v === undefined || cmp(v, arg) < 0) return false;
        break;
      case 'lt':
        if (v === null || v === undefined || cmp(v, arg) >= 0) return false;
        break;
      case 'lte':
        if (v === null || v === undefined || cmp(v, arg) > 0) return false;
        break;
      case 'contains': {
        if (typeof v !== 'string') return false;
        const insensitive = c.mode === 'insensitive';
        const hay = insensitive ? v.toLowerCase() : v;
        const needle = insensitive ? String(arg).toLowerCase() : String(arg);
        if (!hay.includes(needle)) return false;
        break;
      }
      case 'mode':
        break;
      default:
        throw new Error(`fake-table: 지원하지 않는 조건 ${op}`);
    }
  }
  return true;
}

export function matchWhere(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]) => {
    if (cond === undefined) return true;
    if (k === 'AND') return (cond as Where[]).every((w) => matchWhere(row, w));
    if (k === 'OR') return (cond as Where[]).some((w) => matchWhere(row, w));
    if (k === 'NOT') return !matchWhere(row, cond as Where);
    if (!(k in row)) throw new Error(`fake-table: 모르는 필드 또는 관계 필터 ${k}`);
    return matchField(row[k], cond);
  });
}

type OrderBy = Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[];

function sortRows(rows: Row[], orderBy: OrderBy | undefined): Row[] {
  if (!orderBy) return rows;
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o));
  return [...rows].sort((a, b) => {
    for (const [k, dir] of keys) {
      const av = a[k];
      const bv = b[k];
      let c: number;
      // PostgreSQL 기본: asc는 NULL 마지막, desc는 NULL 처음
      if (av === null && bv === null) c = 0;
      else if (av === null) c = 1;
      else if (bv === null) c = -1;
      else c = cmp(av, bv);
      if (dir === 'desc') c = -c;
      if (c !== 0) return c;
    }
    return 0;
  });
}

export type UniqueRule = {
  /** P2002 meta.target으로 보낼 값(Prisma가 실제로 주는 형식을 흉내: 컬럼 배열 또는 인덱스 이름) */
  target: string[] | string;
  fields: string[];
  /** 부분 고유 인덱스 조건 */
  where?: (row: Row) => boolean;
};

export type TableHooks = {
  onDelete?: (deleted: Row[]) => void;
};

function uniqueError(target: string[] | string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on ${String(target)}`, {
    code: 'P2002',
    clientVersion: 'fake',
    meta: { target },
  });
}

function applyData(row: Row, data: Row): void {
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && 'increment' in v) {
      row[k] = (row[k] as number) + ((v as { increment: number }).increment ?? 0);
    } else {
      row[k] = v;
    }
  }
}

export class FakeTable<T extends Row = Row> {
  rows: T[] = [];

  constructor(
    private readonly defaults: (data: Row) => Row,
    private readonly uniques: UniqueRule[] = [],
    public hooks: TableHooks = {},
    private readonly tick: () => Promise<void> = async () => {},
  ) {}

  private checkUnique(): void {
    for (const u of this.uniques) {
      const seen = new Set<string>();
      for (const r of this.rows) {
        if (u.where && !u.where(r)) continue;
        const key = JSON.stringify(u.fields.map((f) => r[f]));
        if (seen.has(key)) throw uniqueError(u.target);
        seen.add(key);
      }
    }
  }

  /** 한 문을 실행하고 고유 제약 위반이면 되돌린다 */
  private statement<R>(fn: () => R): R {
    const snapshot = this.rows.map((r) => ({ ...r }));
    try {
      const out = fn();
      this.checkUnique();
      return out;
    } catch (err) {
      this.rows = snapshot;
      throw err;
    }
  }

  snapshot(): T[] {
    return this.rows.map((r) => ({ ...r }));
  }

  restore(rows: T[]): void {
    this.rows = rows;
  }

  findUnique = async (args: { where: Where }): Promise<T | null> => {
    await this.tick();
    const r = this.rows.find((x) => matchWhere(x, args.where));
    return r ? ({ ...r } as T) : null;
  };

  findFirst = async (args: { where?: Where; orderBy?: OrderBy } = {}): Promise<T | null> => {
    await this.tick();
    const r = sortRows(this.rows.filter((x) => matchWhere(x, args.where)), args.orderBy)[0];
    return r ? ({ ...r } as T) : null;
  };

  findMany = async (args: { where?: Where; orderBy?: OrderBy; take?: number } = {}): Promise<T[]> => {
    await this.tick();
    let rows = sortRows(this.rows.filter((x) => matchWhere(x, args.where)), args.orderBy);
    if (args.take !== undefined) rows = rows.slice(0, args.take);
    return rows.map((r) => ({ ...r }) as T);
  };

  /**
   * groupBy: by, where, _count { _all }, _max { 필드 }, orderBy([{ _count: { 필드: dir } } | { 필드: dir }]), take.
   * _count 정렬은 그룹 행 수 기준(이 테이블 사용처는 NULL 아닌 필드만 센다)
   */
  groupBy = async (args: {
    by: string[];
    where?: Where;
    _count?: { _all?: boolean };
    _max?: Record<string, boolean>;
    orderBy?: Record<string, unknown>[];
    take?: number;
  }): Promise<Row[]> => {
    await this.tick();
    const groups = new Map<string, Row[]>();
    for (const r of this.rows.filter((x) => matchWhere(x, args.where))) {
      const key = JSON.stringify(args.by.map((f) => r[f]));
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }
    let out = [...groups.values()].map((list) => {
      const first = list[0] as Row;
      const g: Row = Object.fromEntries(args.by.map((f) => [f, first[f]]));
      if (args._count) g._count = { _all: list.length };
      if (args._max) {
        g._max = Object.fromEntries(
          Object.keys(args._max).map((f) => {
            const vals = list.map((r) => r[f]).filter((v) => v !== null && v !== undefined);
            return [f, vals.length === 0 ? null : vals.reduce((a, b) => (cmp(a, b) >= 0 ? a : b))];
          }),
        );
      }
      return { g, n: list.length };
    });
    const keys = (args.orderBy ?? []).flatMap((o) => Object.entries(o));
    out = out.sort((a, b) => {
      for (const [k, spec] of keys) {
        const dir = k === '_count' ? (Object.values(spec as object)[0] as string) : (spec as string);
        const c = k === '_count' ? a.n - b.n : cmp(a.g[k], b.g[k]);
        if (c !== 0) return dir === 'desc' ? -c : c;
      }
      return 0;
    });
    const rows = out.map((o) => o.g);
    return args.take === undefined ? rows : rows.slice(0, args.take);
  };

  count = async (args: { where?: Where } = {}): Promise<number> => {
    await this.tick();
    return this.rows.filter((x) => matchWhere(x, args.where)).length;
  };

  create = async (args: { data: Row }): Promise<T> => {
    await this.tick();
    return this.statement(() => {
      const now = new Date();
      const row = { id: randomUUID(), createdAt: now, ...this.defaults(args.data), ...args.data } as Row;
      if ('updatedAt' in row && row.updatedAt === undefined) row.updatedAt = now;
      for (const k of Object.keys(row)) if (row[k] === undefined) row[k] = null;
      this.rows.push(row as T);
      return { ...row } as T;
    });
  };

  /**
   * createMany: 행마다 고유 제약 검사. skipDuplicates면 위반 행만 건너뛴다(INSERT … ON CONFLICT DO NOTHING),
   * 아니면 전체를 되돌리고 P2002
   */
  createMany = async (args: { data: Row[]; skipDuplicates?: boolean }): Promise<{ count: number }> => {
    await this.tick();
    return this.statement(() => {
      let count = 0;
      for (const d of args.data) {
        const before = this.rows.length;
        const now = new Date();
        const row = { id: randomUUID(), createdAt: now, ...this.defaults(d), ...d } as Row;
        if ('updatedAt' in row && row.updatedAt === undefined) row.updatedAt = now;
        for (const k of Object.keys(row)) if (row[k] === undefined) row[k] = null;
        this.rows.push(row as T);
        try {
          this.checkUnique();
          count++;
        } catch (err) {
          this.rows.length = before;
          if (!args.skipDuplicates) throw err;
        }
      }
      return { count };
    });
  };

  updateMany = async (args: { where?: Where; data: Row }): Promise<{ count: number }> => {
    await this.tick();
    return this.statement(() => {
      let count = 0;
      for (const r of this.rows) {
        if (!matchWhere(r, args.where)) continue;
        applyData(r, args.data);
        if ('updatedAt' in r) (r as Row).updatedAt = new Date();
        count++;
      }
      return { count };
    });
  };

  update = async (args: { where: Where; data: Row }): Promise<T> => {
    await this.tick();
    return this.statement(() => {
      const r = this.rows.find((x) => matchWhere(x, args.where));
      if (!r) {
        throw new Prisma.PrismaClientKnownRequestError('Record not found', { code: 'P2025', clientVersion: 'fake' });
      }
      applyData(r, args.data);
      if ('updatedAt' in r) (r as Row).updatedAt = new Date();
      return { ...r } as T;
    });
  };

  deleteMany = async (args: { where?: Where } = {}): Promise<{ count: number }> => {
    await this.tick();
    const deleted = this.rows.filter((x) => matchWhere(x, args.where));
    this.rows = this.rows.filter((x) => !matchWhere(x, args.where));
    this.hooks.onDelete?.(deleted);
    return { count: deleted.length };
  };

  /** 테스트 준비용 동기 삽입(기본값·고유 제약 적용) */
  insert(data: Row): T {
    return this.statement(() => {
      const now = new Date();
      const row = { id: randomUUID(), createdAt: now, ...this.defaults(data), ...data } as Row;
      if ('updatedAt' in row && row.updatedAt === undefined) row.updatedAt = now;
      for (const k of Object.keys(row)) if (row[k] === undefined) row[k] = null;
      this.rows.push(row as T);
      return row as T;
    });
  }
}
