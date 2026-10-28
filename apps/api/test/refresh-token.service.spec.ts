import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/common/app-error';
import { RefreshTokenService } from '../src/modules/auth/refresh-token.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { FakePrisma } from './support/fake-prisma';
import { testConfig } from './support/test-app';

function setup() {
  const prisma = new FakePrisma();
  const svc = new RefreshTokenService(prisma as unknown as PrismaService, testConfig());
  return { prisma, svc };
}

const USER = '6f1c1a8e-8a3a-4b8e-9a59-0b5e0a0c0d01';

afterEach(() => vi.useRealTimers());

describe('RefreshTokenService', () => {
  it('30일 절대 만료로 발급', async () => {
    const { prisma, svc } = setup();
    const before = Date.now();
    const issued = await svc.issueNewFamily(USER, 'UA');
    const ttl = issued.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(30 * 86_400_000 - 1000);
    expect(ttl).toBeLessThanOrEqual(30 * 86_400_000 + 1000);
    expect(prisma.refreshTokens[0]?.userAgent).toBe('UA');
  });

  it('동시 회전: 조건부 update에서 진 쪽은 유예로 처리(재사용 오탐 없음)', async () => {
    const { prisma, svc } = setup();
    const { raw } = await svc.issueNewFamily(USER);
    const [a, b] = await Promise.all([svc.rotate(raw), svc.rotate(raw)]);
    expect([a.kind, b.kind].sort()).toEqual(['grace', 'rotated']);
    expect(prisma.refreshTokens).toHaveLength(2);
    expect(prisma.refreshTokens.filter((t) => t.revokedAt === null)).toHaveLength(1);
  });

  it('회전해도 만료 시각은 연장되지 않는다', async () => {
    const { svc } = setup();
    const first = await svc.issueNewFamily(USER);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 5 * 86_400_000 });
    const r = await svc.rotate(first.raw);
    expect(r.kind).toBe('rotated');
    if (r.kind === 'rotated') expect(r.next.expiresAt.getTime()).toBe(first.expiresAt.getTime());
  });

  it('유예 경계: 10초 정확히는 유예, 10.001초는 REUSED', async () => {
    const { svc } = setup();
    const start = Date.now();
    vi.useFakeTimers({ toFake: ['Date'], now: start });
    const { raw } = await svc.issueNewFamily(USER);
    await svc.rotate(raw);
    vi.setSystemTime(start + 10_000);
    expect((await svc.rotate(raw)).kind).toBe('grace');
    vi.setSystemTime(start + 10_001);
    const err = await svc.rotate(raw).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('REFRESH_TOKEN_REUSED');
  });

  it('로그아웃(revokeByRaw)으로 폐기된 토큰 → INVALID, 모르는 토큰 로그아웃은 무시', async () => {
    const { svc } = setup();
    const { raw } = await svc.issueNewFamily(USER);
    await svc.revokeByRaw('unknown');
    await svc.revokeByRaw(undefined);
    await svc.revokeByRaw(raw);
    const err = await svc.rotate(raw).catch((e: unknown) => e);
    expect((err as AppError).code).toBe('REFRESH_TOKEN_INVALID');
  });
});
