import { randomUUID } from 'node:crypto';
import { type ApiKeyScope, ApiKeyScope as ApiKeyScopeSchema, BOT_API_KEY_HEADER } from '@gcd/shared';
import { generateApiKey } from '../../src/common/api-key';
import type { TestApp } from './test-app';

/** S5 테스트 공통 준비(DB 없이 FakePrisma에 행을 직접 심는다). 계약: _workspace/01_architect_contract.md 14절 backend 5번 */

export const ALL_SCOPES: ApiKeyScope[] = [...ApiKeyScopeSchema.options];

/** 봇 API 키 1개(원문 반환). 기본 scope 전부 */
export function seedApiKey(
  app: TestApp,
  o: { scopes?: ApiKeyScope[]; revokedAt?: Date | null; lastUsedAt?: Date | null; name?: string } = {},
): { raw: string; id: string } {
  const k = generateApiKey();
  const row = app.prisma.apiKey.insert({
    name: o.name ?? '테스트 봇',
    keyHash: k.hash,
    keyPrefix: k.prefix,
    scopes: o.scopes ?? ALL_SCOPES,
    revokedAt: o.revokedAt ?? null,
    lastUsedAt: o.lastUsedAt ?? null,
  });
  return { raw: k.raw, id: row.id };
}

/** 봇 요청. key가 undefined면 헤더 없음 */
export function bot(
  app: TestApp,
  method: string,
  path: string,
  key: string | undefined,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const h: Record<string, string> = { ...headers };
  if (key !== undefined) h[BOT_API_KEY_HEADER] = key;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  return fetch(`${app.base}${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
}

let snowflakeSeq = 100_000_000_000_000_000n;
/** 서로 다른 snowflake(18자리) */
export function snowflake(): string {
  snowflakeSeq += 1n;
  return snowflakeSeq.toString();
}

/** 디스코드 연동 회원(discord_id = snowflake) */
export async function linkedMember(
  app: TestApp,
  nickname: string,
  o: { discordId?: string; leftAt?: Date | null; notifyScrimStart?: boolean } = {},
): Promise<{ id: string; discordId: string }> {
  const discordId = o.discordId ?? snowflake();
  const u = await app.prisma.user.create({ data: { nickname, discordId, leftAt: o.leftAt ?? null } });
  if (o.notifyScrimStart === false) {
    const row = app.prisma.users.find((x) => x.id === u.id);
    if (row) row.notifyScrimStart = false;
  }
  return { id: u.id, discordId };
}

/** 활동 행 직접 삽입(집계 테스트용) */
export function seedActivity(
  app: TestApp,
  userId: string,
  o: { type?: 'voice' | 'chat' | 'play'; game?: 'lol' | 'tft' | 'steam' | null; startedAt: string; durationSec?: number; key?: string },
) {
  const type = o.type ?? 'voice';
  return app.prisma.activityLog.insert({
    userId,
    type,
    gameId: o.game ? app.prisma.gameId(o.game) : null,
    startedAt: new Date(o.startedAt),
    durationSec: o.durationSec ?? (type === 'chat' ? 0 : 3600),
    idempotencyKey: o.key ?? `seed-${randomUUID()}`,
  });
}

/** 스팀 계정 + 플레이타임 행 */
export function seedSteam(
  app: TestApp,
  userId: string,
  apps: { appId: number; total: number; recent?: number; name?: string | null; syncedAt?: string }[],
  o: { primary?: boolean; verified?: boolean; displayName?: string } = {},
) {
  const acc = app.prisma.gameAccount.insert({
    userId,
    gameId: app.prisma.gameId('steam'),
    externalId: `7656119${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`,
    displayName: o.displayName ?? 'steamer',
    verified: o.verified ?? true,
    isPrimary: o.primary ?? true,
  });
  for (const a of apps) {
    app.prisma.steamPlaytime.insert({
      gameAccountId: acc.id,
      appId: a.appId,
      appName: a.name === undefined ? `App ${a.appId}` : a.name,
      minutesTotal: a.total,
      minutesRecent: a.recent ?? 0,
      syncedAt: new Date(a.syncedAt ?? '2026-10-27T20:00:00.000Z'),
    });
  }
  return acc;
}

/**
 * 내전 + 참가자 + 결과 행 직접 삽입(활동 랭킹 scrim_count 테스트용, D239).
 * startedAt null이면 시작 기록 없는 옛 행(scheduled_at으로 귀속).
 */
export function seedScrimWithResult(
  app: TestApp,
  o: {
    hostId: string;
    players: { userId: string; status?: 'joined' | 'waitlist' | 'cancelled' | 'no_show' }[];
    scheduledAt: string;
    startedAt: string | null;
    status?: 'recruiting' | 'full' | 'playing' | 'finished' | 'cancelled';
    results?: ('pending' | 'approved' | 'rejected')[];
    rated?: boolean;
    game?: 'lol' | 'tft' | 'steam';
  },
): { scrimId: string } {
  const s = app.prisma.scrim.insert({
    gameId: app.prisma.gameId(o.game ?? 'lol'),
    hostId: o.hostId,
    title: '활동 집계용 내전',
    scheduledAt: new Date(o.scheduledAt),
    capacity: Math.max(2, o.players.length),
    status: o.status ?? 'finished',
    rated: o.rated ?? true,
    startedAt: o.startedAt === null ? null : new Date(o.startedAt),
  });
  o.players.forEach((p, i) =>
    app.prisma.scrimPlayer.insert({ scrimId: s.id, userId: p.userId, status: p.status ?? 'joined', joinedAt: new Date(Date.parse(o.scheduledAt) - 3_600_000 + i) }),
  );
  for (const status of o.results ?? ['approved']) {
    app.prisma.scrimResult.insert({ scrimId: s.id, status, winnerTeam: 'blue', submittedById: o.hostId, createdAt: new Date(o.scheduledAt) });
  }
  return { scrimId: s.id };
}
