/**
 * S6 관리자 도구 DB e2e — 실제 PostgreSQL 필요. TEST_DATABASE_URL이 없으면 건너뛴다(skip). 계약 S6 18절 backend 「DB 필요(작성만)」.
 * - 되돌리기 vs 같은 사용자의 다른 내전 승인 동시 경합(사용자 advisory 잠금으로 직렬화, 「마지막 이력」 판정이 흔들리지 않음)
 * - 시즌 FOR NO KEY UPDATE(시즌 수정) vs 승인 FOR SHARE
 * - `@db.Date` 왕복(KST 날짜가 하루 밀리지 않음)
 * - 멤버 검색 ILIKE 이스케이프(`%`, `_`)
 * - `ALTER TYPE scrim_result_status ADD VALUE 'reverted'` 적용 뒤 reverted 저장
 *
 * 실행 방법(scrim-results.db.e2e.spec.ts와 같다): docker compose up -d postgres → TEST_DATABASE_URL 지정 → prisma:deploy → test.
 * 주의: 각 테스트 전에 S6 표와 users·scrims·seasons 등을 비운다(CASCADE). 운영 스키마를 가리키지 말 것.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  API_PREFIX,
  DevLoginResponse,
  GAME_SEED,
  ListAdminMembersResponse,
  PatchNoteView,
  ScrimDetail,
} from '@gcd/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { APP_CONFIG } from '../../src/config/env';
import { DISCORD_OAUTH_CLIENT } from '../../src/modules/auth/discord-oauth.client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { mockDiscord, testConfig } from '../support/test-app';

const DB_URL = process.env.TEST_DATABASE_URL;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe.skipIf(!DB_URL)('[DB] S6 관리자 도구 e2e (PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let base: string;

  beforeAll(async () => {
    prisma = new PrismaService({ datasources: { db: { url: DB_URL as string } } });
    const config = testConfig({ DATABASE_URL: DB_URL });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(config)
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(DISCORD_OAUTH_CLIENT)
      .useValue(mockDiscord())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, config);
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as { port: number };
    base = `http://127.0.0.1:${port}${API_PREFIX}`;
    for (const g of GAME_SEED) {
      await prisma.game.upsert({
        where: { code: g.code },
        update: {},
        create: {
          code: g.code,
          name: g.name,
          hasPositions: g.has_positions,
          hasTeams: g.has_teams,
          hasResults: g.has_results,
          positions: g.positions,
          sortOrder: g.sort_order,
          capacityMin: g.capacity_min,
          capacityMax: g.capacity_max,
          capacityDefault: g.capacity_default,
          capacityStep: g.capacity_step,
          startRequiresFull: g.start_requires_full,
          requiresSteamApp: g.requires_steam_app,
        },
      });
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE admin_audit_logs, patch_notes, events, notices, scrim_result_disputes, rating_history, ratings, scrim_results, seasons, scrims, users CASCADE',
    );
  });

  async function login(username: string, role?: 'admin') {
    const res = await fetch(`${base}/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(role ? { username, role } : { username }),
    });
    const body = DevLoginResponse.parse(await res.json());
    return { token: body.access_token, userId: body.user.id };
  }

  const req = (method: string, path: string, token: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  async function season() {
    const now = Date.now();
    return prisma.season.create({ data: { name: 'DB 시즌', startsAt: new Date(now - 10 * DAY), endsAt: new Date(now + 30 * DAY) } });
  }

  async function playingScrim(hostId: string, userIds: string[]): Promise<string> {
    const lol = await prisma.game.findUniqueOrThrow({ where: { code: 'lol' } });
    const now = Date.now();
    const s = await prisma.scrim.create({
      data: {
        gameId: lol.id,
        hostId,
        title: 'DB 내전',
        scheduledAt: new Date(now - HOUR),
        capacity: userIds.length,
        status: 'playing',
        startedAt: new Date(now - HOUR / 2),
        rated: true,
        usePositions: false,
      },
    });
    const half = userIds.length / 2;
    for (const [i, userId] of userIds.entries()) {
      await prisma.scrimPlayer.create({
        data: { scrimId: s.id, userId, status: 'joined', joinedAt: new Date(now - 2 * HOUR + i * 1000), team: i < half ? 'blue' : 'orange' },
      });
    }
    return s.id;
  }

  async function submitted(token: string, scrimId: string): Promise<string> {
    const res = await req('POST', `/scrims/${scrimId}/result`, token, { winner_team: 'blue' });
    expect(res.status).toBe(200);
    return ScrimDetail.parse(await res.json()).result?.id as string;
  }

  it('ALTER TYPE ADD VALUE 뒤 reverted 저장 + 되돌리기 정상(ratings 역반영·이력 삭제)', async () => {
    await season();
    const host = await login('host');
    const others = await Promise.all(['b', 'c', 'd'].map((n) => login(n)));
    const admin = await login('boss', 'admin');
    const scrimId = await playingScrim(host.userId, [host.userId, ...others.map((o) => o.userId)]);
    const resultId = await submitted(host.token, scrimId);
    expect((await req('POST', `/scrims/${scrimId}/result/approve`, admin.token, { result_id: resultId })).status).toBe(200);
    const res = await req('POST', `/scrims/${scrimId}/result/revert`, admin.token, { result_id: resultId, reason: 'DB 되돌리기' });
    expect(res.status).toBe(200);
    const row = await prisma.scrimResult.findUniqueOrThrow({ where: { id: resultId } });
    expect(row.status).toBe('reverted');
    expect(await prisma.ratingHistory.count({ where: { scrimResultId: resultId } })).toBe(0);
    const ratings = await prisma.rating.findMany();
    expect(ratings.every((r) => r.elo === 1000 && r.wins === 0 && r.losses === 0)).toBe(true);
    expect(await prisma.adminAuditLog.count({ where: { action: 'result.revert' } })).toBe(1);
  });

  it('되돌리기 vs 같은 사용자의 다른 내전 승인 동시(Promise.all) → 둘 다 성공하거나 되돌리기만 later_games로 409, 데이터 일관', async () => {
    await season();
    const host = await login('host');
    const ps = await Promise.all(['b', 'c', 'd', 'e', 'f', 'g'].map((n) => login(n)));
    const admin = await login('boss', 'admin');
    const x = await playingScrim(host.userId, [host.userId, ps[0]!.userId, ps[1]!.userId, ps[2]!.userId]);
    const xr = await submitted(host.token, x);
    expect((await req('POST', `/scrims/${x}/result/approve`, admin.token, { result_id: xr })).status).toBe(200);
    const y = await playingScrim(host.userId, [host.userId, ps[3]!.userId, ps[4]!.userId, ps[5]!.userId]);
    const yr = await submitted(host.token, y);
    const [rv, ap] = await Promise.all([
      req('POST', `/scrims/${x}/result/revert`, admin.token, { result_id: xr, reason: '경합' }),
      req('POST', `/scrims/${y}/result/approve`, admin.token, { result_id: yr }),
    ]);
    expect(ap.status).toBe(200);
    expect([200, 409]).toContain(rv.status);
    const hostRating = await prisma.rating.findFirstOrThrow({ where: { userId: host.userId } });
    const hist = await prisma.ratingHistory.findMany({ where: { userId: host.userId }, orderBy: { createdAt: 'asc' } });
    // ratings = 마지막 이력 elo_after(되돌리기가 이겼으면 Y만, 졌으면 X·Y)
    expect(hostRating.elo).toBe(hist[hist.length - 1]?.eloAfter);
    if (rv.status === 200) expect(hist).toHaveLength(1);
    else expect(hist).toHaveLength(2);
  });

  it('시즌 수정(FOR NO KEY UPDATE)과 승인(FOR SHARE) 동시 → 둘 다 성공, 승인 이력은 그 시즌', async () => {
    const s = await season();
    const host = await login('host');
    const ps = await Promise.all(['b', 'c', 'd'].map((n) => login(n)));
    const admin = await login('boss', 'admin');
    const x = await playingScrim(host.userId, [host.userId, ...ps.map((p) => p.userId)]);
    const xr = await submitted(host.token, x);
    const [ap, up] = await Promise.all([
      req('POST', `/scrims/${x}/result/approve`, admin.token, { result_id: xr }),
      req('PATCH', `/admin/seasons/${s.id}`, admin.token, { ends_at: new Date(Date.now() + 40 * DAY).toISOString() }),
    ]);
    expect(ap.status).toBe(200);
    expect(up.status).toBe(200);
    expect((await prisma.ratingHistory.findFirstOrThrow({ where: { scrimResultId: xr } })).seasonId).toBe(s.id);
  });

  it('@db.Date 왕복: published_on 2026-11-01 → 그대로 2026-11-01', async () => {
    const admin = await login('boss', 'admin');
    const res = await req('POST', '/admin/patch-notes', admin.token, { game: 'lol', title: '날짜 왕복', summary: '요약', published_on: '2026-11-01' });
    expect(res.status).toBe(201);
    expect(PatchNoteView.parse(await res.json()).published_on).toBe('2026-11-01');
    const rows = await prisma.$queryRawUnsafe<{ d: string }[]>("SELECT published_on::text AS d FROM patch_notes");
    expect(rows[0]?.d).toBe('2026-11-01');
  });

  it('멤버 검색 ILIKE: % _ 는 글자 그대로, 대소문자 무시', async () => {
    const admin = await login('boss', 'admin');
    await prisma.user.create({ data: { nickname: 'Gamer100%' } });
    await prisma.user.create({ data: { nickname: 'gamer1000' } });
    const q = async (s: string) =>
      ListAdminMembersResponse.parse(await (await req('GET', `/admin/members?q=${encodeURIComponent(s)}`, admin.token)).json()).items.map(
        (i) => i.user.nickname,
      );
    expect((await q('GAMER')).sort()).toEqual(['Gamer100%', 'gamer1000']);
    expect(await q('100%')).toEqual(['Gamer100%']);
    expect(await q('e_1')).toEqual([]);
  });
});
