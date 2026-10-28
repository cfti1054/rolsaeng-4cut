import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** 연결은 첫 쿼리 때 맺는다(지연 연결). 종료 시 끊는다. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/** Prisma 고유 제약 위반(P2002)인지, 대상 필드가 맞는지 */
export function isUniqueViolation(err: unknown, field?: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; meta?: { target?: unknown } };
  if (e.code !== 'P2002') return false;
  if (!field) return true;
  const target = e.meta?.target;
  if (Array.isArray(target)) return target.some((t) => String(t).includes(field));
  if (typeof target === 'string') return target.includes(field);
  return false;
}
