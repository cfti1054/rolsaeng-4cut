import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/common/app-error';
import { RefreshTokenService } from '../src/modules/auth/refresh-token.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { FakePrisma } from './support/fake-prisma';
import { testConfig } from './support/test-app';

/** 기본은 S0·S1 동작(매번 회전, REFRESH_ROTATE_AFTER_HOURS=0). 하루 1회 회전 테스트는 hours를 넘긴다 */
function setup(hours = '0') {
  const prisma = new FakePrisma();
  const svc = new RefreshTokenService(prisma as unknown as PrismaService, testConfig({ REFRESH_ROTATE_AFTER_HOURS: hours }));
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

  it('(D73) 24시간 미만은 kept(DB 쓰기 없음), 24시간 정각부터 rotated', async () => {
    const { prisma, svc } = setup('24');
    const start = Date.now();
    vi.useFakeTimers({ toFake: ['Date'], now: start });
    const { raw } = await svc.issueNewFamily(USER);
    vi.setSystemTime(start + 24 * 3_600_000 - 1);
    expect(await svc.rotate(raw)).toEqual({ kind: 'kept', userId: USER });
    expect(prisma.refreshTokens).toHaveLength(1);
    expect(prisma.refreshTokens[0]?.revokedAt).toBeNull();
    vi.setSystemTime(start + 24 * 3_600_000);
    expect((await svc.rotate(raw)).kind).toBe('rotated');
    expect(prisma.refreshTokens).toHaveLength(2);
  });

  it('(D73) 동시 refresh 24시간 경계: 한쪽 회전, 나머지는 유예(재사용 오탐 없음)', async () => {
    const { prisma, svc } = setup('24');
    const start = Date.now();
    vi.useFakeTimers({ toFake: ['Date'], now: start });
    const { raw } = await svc.issueNewFamily(USER);
    vi.setSystemTime(start + 24 * 3_600_000);
    const kinds = (await Promise.all([svc.rotate(raw), svc.rotate(raw), svc.rotate(raw)])).map((r) => r.kind).sort();
    expect(kinds).toEqual(['grace', 'grace', 'rotated']);
    expect(prisma.refreshTokens.filter((t) => t.revokedAt === null)).toHaveLength(1);
  });

  it('(D73) 0이면 발급 직후에도 회전', async () => {
    const { svc } = setup('0');
    const { raw } = await svc.issueNewFamily(USER);
    expect((await svc.rotate(raw)).kind).toBe('rotated');
  });
});
