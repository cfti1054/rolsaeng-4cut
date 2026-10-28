import { randomUUID } from 'node:crypto';
import { Prisma, type RefreshToken, type User } from '@prisma/client';

/**
 * DB 없이 auth·users 흐름을 검증하기 위한 인메모리 Prisma 대체.
 * 이 모듈들이 실제로 쓰는 호출만 구현한다(user: findUnique/create/update, refreshToken:
 * findUnique/findFirst/create/updateMany, $transaction(fn)).
 *
 * 한계(실제 DB e2e로 보완해야 함):
 * - 트랜잭션은 직렬화(뮤텍스) + 실패 시 스냅샷 복원. 격리 수준·행 잠금은 흉내 내지 않는다.
 * - where는 등호, null, { gt } 만 지원. select는 무시하고 행 전체를 돌려준다.
 */

type Where = Record<string, unknown>;

function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { gt?: unknown };
      if ('gt' in c) {
        if (v instanceof Date && c.gt instanceof Date) return v.getTime() > c.gt.getTime();
        return (v as number) > (c.gt as number);
      }
      throw new Error(`fake-prisma: 지원하지 않는 조건 ${k}=${JSON.stringify(cond)}`);
    }
    if (v instanceof Date && cond instanceof Date) return v.getTime() === cond.getTime();
    return v === cond;
  });
}

function uniqueError(target: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on ${target}`, {
    code: 'P2002',
    clientVersion: 'fake',
    meta: { target: [target] },
  });
}

function clone<T>(rows: T[]): T[] {
  return rows.map((r) => ({ ...r }));
}

export class FakePrisma {
  users: User[] = [];
  refreshTokens: RefreshToken[] = [];
  private txQueue: Promise<unknown> = Promise.resolve();

  /** 테스트에서 호출 순서를 섞기 위한 지연(마이크로태스크 양보) */
  private async tick(): Promise<void> {
    await new Promise((r) => setImmediate(r));
  }

  user = {
    findUnique: async (args: { where: Where }): Promise<User | null> => {
      await this.tick();
      const row = this.users.find((u) => matches(u as unknown as Record<string, unknown>, args.where));
      return row ? { ...row } : null;
    },
    create: async (args: { data: Partial<User> & { nickname: string } }): Promise<User> => {
      await this.tick();
      const d = args.data;
      if (this.users.some((u) => u.nickname === d.nickname)) throw uniqueError('nickname');
      if (d.discordId && this.users.some((u) => u.discordId === d.discordId)) throw uniqueError('discord_id');
      const now = new Date();
      const row: User = {
        id: d.id ?? randomUUID(),
        email: d.email ?? null,
        nickname: d.nickname,
        role: d.role ?? 'member',
        discordId: d.discordId ?? null,
        discordUsername: d.discordUsername ?? null,
        discordGlobalName: d.discordGlobalName ?? null,
        discordAvatar: d.discordAvatar ?? null,
        discordGuildVerifiedAt: d.discordGuildVerifiedAt ?? null,
        nicknameConfirmedAt: d.nicknameConfirmedAt ?? null,
        lastLoginAt: d.lastLoginAt ?? null,
        notifyScrimStart: true,
        notifyResult: true,
        notifyWaitlist: true,
        notifyPatch: false,
        createdAt: d.createdAt ?? now,
        updatedAt: now,
      };
      this.users.push(row);
      return { ...row };
    },
    update: async (args: { where: { id: string }; data: Partial<User> }): Promise<User> => {
      await this.tick();
      const row = this.users.find((u) => u.id === args.where.id);
      if (!row) {
        throw new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: 'fake',
        });
      }
      const d = args.data;
      if (d.nickname !== undefined && this.users.some((u) => u.id !== row.id && u.nickname === d.nickname)) {
        throw uniqueError('nickname');
      }
      for (const [k, v] of Object.entries(d)) {
        if (v !== undefined) (row as unknown as Record<string, unknown>)[k] = v;
      }
      row.updatedAt = new Date();
      return { ...row };
    },
  };

  refreshToken = {
    findUnique: async (args: { where: Where }): Promise<RefreshToken | null> => {
      await this.tick();
      const row = this.refreshTokens.find((t) => matches(t as unknown as Record<string, unknown>, args.where));
      return row ? { ...row } : null;
    },
    findFirst: async (args: { where: Where }): Promise<RefreshToken | null> => {
      await this.tick();
      const row = this.refreshTokens.find((t) => matches(t as unknown as Record<string, unknown>, args.where));
      return row ? { ...row } : null;
    },
    create: async (args: { data: Partial<RefreshToken> & Pick<RefreshToken, 'userId' | 'tokenHash' | 'familyId' | 'expiresAt'> }): Promise<RefreshToken> => {
      await this.tick();
      const d = args.data;
      if (this.refreshTokens.some((t) => t.tokenHash === d.tokenHash)) throw uniqueError('token_hash');
      const row: RefreshToken = {
        id: d.id ?? randomUUID(),
        userId: d.userId,
        tokenHash: d.tokenHash,
        familyId: d.familyId,
        expiresAt: d.expiresAt,
        revokedAt: d.revokedAt ?? null,
        replacedById: d.replacedById ?? null,
        userAgent: d.userAgent ?? null,
        createdAt: new Date(),
      };
      this.refreshTokens.push(row);
      return { ...row };
    },
    updateMany: async (args: { where: Where; data: Partial<RefreshToken> }): Promise<{ count: number }> => {
      await this.tick();
      let count = 0;
      for (const t of this.refreshTokens) {
        if (!matches(t as unknown as Record<string, unknown>, args.where)) continue;
        Object.assign(t, args.data);
        count += 1;
      }
      return { count };
    },
  };

  async $transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const snapshot = { users: clone(this.users), tokens: clone(this.refreshTokens) };
      try {
        return await fn(this);
      } catch (err) {
        this.users = snapshot.users;
        this.refreshTokens = snapshot.tokens;
        throw err;
      }
    };
    const result = this.txQueue.then(run, run);
    this.txQueue = result.catch(() => undefined);
    return result;
  }

  async $disconnect(): Promise<void> {}
}
