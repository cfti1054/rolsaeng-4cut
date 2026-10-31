/**
 * S5 POST /bot/activity(계약 6-2): 건별 결과, 멱등, 시각 한도, 미연동, 탈퇴 회원, 경합(ON CONFLICT), api_key_id.
 * DB 없이 FakePrisma. 실제 동시 INSERT는 test/db/bot.db.e2e.spec.ts.
 */
import {
  BOT_ACTIVITY_BATCH_MAX,
  BOT_ACTIVITY_FUTURE_TOLERANCE_SEC,
  BOT_ACTIVITY_MAX_AGE_DAYS,
  PostBotActivityResponse,
} from '@gcd/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectError } from './support/s1-helpers';
import { bot, linkedMember, seedApiKey } from './support/s5-helpers';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
  vi.restoreAllMocks();
});

const NOW = '2026-10-27T13:00:00.000Z'; // 화요일 22:00 KST
const DISCORD_ID = '123456789012345678';

async function send(app: TestApp, key: string, events: unknown[]): Promise<PostBotActivityResponse> {
  const res = await bot(app, 'POST', '/bot/activity', key, { events });
  const text = await res.text();
  expect({ status: res.status, text }).toMatchObject({ status: 200 });
  return PostBotActivityResponse.strict().parse(JSON.parse(text));
}

const voice = (key: string, o: Record<string, unknown> = {}) => ({
  idempotency_key: key,
  discord_id: DISCORD_ID,
  type: 'voice',
  game: 'lol',
  started_at: '2026-10-27T20:10:00+09:00',
  duration_sec: 3600,
  ...o,
});

describe('POST /bot/activity', () => {
  it('문서 예시 그대로 → created 2건, 행 저장(api_key_id·game_id 기록), 재전송 → duplicate(행 수 불변)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t, { scopes: ['bot:activity'] });
    const u = await linkedMember(t, '새벽감자', { discordId: DISCORD_ID });
    const events = [
      voice('voice-123456789012345678-20261027T2010'),
      {
        idempotency_key: 'chat-123456789012345678-20261027',
        discord_id: DISCORD_ID,
        type: 'chat',
        started_at: '2026-10-27T20:15:00+09:00',
        duration_sec: 0,
      },
    ];
    const first = await send(t, k.raw, events);
    expect(first.results).toEqual([
      { idempotency_key: 'voice-123456789012345678-20261027T2010', status: 'created', reason: null },
      { idempotency_key: 'chat-123456789012345678-20261027', status: 'created', reason: null },
    ]);
    expect(first.counts).toEqual({ created: 2, duplicate: 0, unlinked: 0, rejected: 0 });
    const rows = t.prisma.activityLog.rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      userId: u.id,
      type: 'voice',
      gameId: t.prisma.gameId('lol'),
      startedAt: new Date('2026-10-27T11:10:00.000Z'),
      durationSec: 3600,
      apiKeyId: k.id,
    });
    expect(rows[1]).toMatchObject({ type: 'chat', gameId: null, durationSec: 0, apiKeyId: k.id });

    const again = await send(t, k.raw, events);
    expect(again.results.map((r) => r.status)).toEqual(['duplicate', 'duplicate']);
    expect(again.counts).toEqual({ created: 0, duplicate: 2, unlinked: 0, rejected: 0 });
    expect(t.prisma.activityLog.rows).toHaveLength(2);
  });

  it('배치 안 같은 키 3번 → created·duplicate·duplicate, 내용이 달라도 먼저 온 것이 남는다', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    await linkedMember(t, 'a', { discordId: DISCORD_ID });
    const r = await send(t, k.raw, [voice('k1'), voice('k1', { duration_sec: 10 }), voice('k1', { type: 'play' })]);
    expect(r.results.map((x) => x.status)).toEqual(['created', 'duplicate', 'duplicate']);
    expect(t.prisma.activityLog.rows).toHaveLength(1);
    expect(t.prisma.activityLog.rows[0]).toMatchObject({ durationSec: 3600, type: 'voice' });
  });

  it('미연동 discord_id → unlinked(행 없음), 탈퇴 회원 → 저장(created)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    const left = await linkedMember(t, '나감', { leftAt: new Date('2026-10-20T00:00:00.000Z') });
    const r = await send(t, k.raw, [
      voice('u1', { discord_id: '999999999999999999' }),
      voice('u2', { discord_id: left.discordId }),
    ]);
    expect(r.results.map((x) => x.status)).toEqual(['unlinked', 'created']);
    expect(r.counts).toEqual({ created: 1, duplicate: 0, unlinked: 1, rejected: 0 });
    expect(t.prisma.activityLog.rows.map((x) => x.userId)).toEqual([left.id]);
  });

  it('과거 7일 경계(같으면 허용, 1ms 더 이르면 STARTED_AT_TOO_OLD), 미래 경계(끝 = now + 300초 허용, +1ms ENDS_IN_FUTURE)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    await linkedMember(t, 'a', { discordId: DISCORD_ID });
    const now = new Date(NOW).getTime();
    const oldest = new Date(now - BOT_ACTIVITY_MAX_AGE_DAYS * 86_400_000);
    const futureEnd = now + BOT_ACTIVITY_FUTURE_TOLERANCE_SEC * 1000;
    const r = await send(t, k.raw, [
      voice('old-ok', { started_at: oldest.toISOString() }),
      voice('old-ng', { started_at: new Date(oldest.getTime() - 1).toISOString() }),
      voice('fut-ok', { started_at: new Date(futureEnd - 60_000).toISOString(), duration_sec: 60 }),
      voice('fut-ng', { started_at: new Date(futureEnd - 60_000 + 1).toISOString(), duration_sec: 60 }),
    ]);
    expect(r.results).toEqual([
      { idempotency_key: 'old-ok', status: 'created', reason: null },
      { idempotency_key: 'old-ng', status: 'rejected', reason: 'STARTED_AT_TOO_OLD' },
      { idempotency_key: 'fut-ok', status: 'created', reason: null },
      { idempotency_key: 'fut-ng', status: 'rejected', reason: 'ENDS_IN_FUTURE' },
    ]);
    expect(t.prisma.activityLog.rows).toHaveLength(2);
  });

  it('rejected 키는 쓰지 않는다: 같은 요청 뒤의 정상 이벤트 → created / 저장된 키 + 시각 초과 → duplicate(판정 순서)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    await linkedMember(t, 'a', { discordId: DISCORD_ID });
    const tooOld = '2026-10-01T00:00:00+09:00';
    const r1 = await send(t, k.raw, [voice('x', { started_at: tooOld }), voice('x')]);
    expect(r1.results.map((r) => r.status)).toEqual(['rejected', 'created']);
    const r2 = await send(t, k.raw, [voice('x', { started_at: tooOld })]);
    expect(r2.results).toEqual([{ idempotency_key: 'x', status: 'duplicate', reason: null }]);
  });

  it('형식 오류는 요청 전체 400: chat 0초 아님, voice 0초, 101건, 모르는 필드, 모르는 게임, 오프셋 없는 시각, 빈 배열', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    await linkedMember(t, 'a', { discordId: DISCORD_ID });
    const bad: unknown[][] = [
      [voice('c', { type: 'chat', game: null, duration_sec: 5 })],
      [voice('v', { duration_sec: 0 })],
      Array.from({ length: BOT_ACTIVITY_BATCH_MAX + 1 }, (_, i) => voice(`b${i}`)),
      [voice('f', { extra: 1 })],
      [voice('g', { game: 'valorant' })],
      [voice('o', { started_at: '2026-10-27T20:10:00' })],
      [voice('d', { duration_sec: 86_401 })],
      [],
    ];
    for (const events of bad) {
      await expectError(await bot(t, 'POST', '/bot/activity', k.raw, { events }), 400, 'VALIDATION_FAILED');
    }
    const res = await bot(t, 'POST', '/bot/activity', k.raw, { events: [voice('ok'), voice('bad', { type: 'nope' })] });
    const body = await expectError(res, 400, 'VALIDATION_FAILED');
    expect(body.details?.map((d) => d.path)).toContain('events.1.type');
    await expectError(await bot(t, 'POST', '/bot/activity', k.raw, { events: [voice('ok')], x: 1 }), 400, 'VALIDATION_FAILED');
    expect(t.prisma.activityLog.rows).toHaveLength(0);
    // 100건은 받는다
    const ok = await send(t, k.raw, Array.from({ length: BOT_ACTIVITY_BATCH_MAX }, (_, i) => voice(`m${i}`)));
    expect(ok.counts.created).toBe(BOT_ACTIVITY_BATCH_MAX);
  });

  it('경합: 미리 읽은 뒤 다른 요청이 같은 키를 먼저 저장 → ON CONFLICT로 duplicate, 먼저 저장된 행 유지', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    const other = seedApiKey(t);
    const u = await linkedMember(t, 'a', { discordId: DISCORD_ID });
    t.prisma.rawHooks['gcd:activity-insert'] = () => {
      if (!t) return;
      t.prisma.rawHooks['gcd:activity-insert'] = undefined;
      t.prisma.activityLog.insert({
        userId: u.id,
        type: 'voice',
        startedAt: new Date('2026-10-27T11:10:00.000Z'),
        durationSec: 5,
        idempotencyKey: 'race',
        apiKeyId: other.id,
      });
    };
    const r = await send(t, k.raw, [voice('race'), voice('fresh')]);
    expect(r.results.map((x) => x.status)).toEqual(['duplicate', 'created']);
    expect(r.counts).toEqual({ created: 1, duplicate: 1, unlinked: 0, rejected: 0 });
    expect(t.prisma.activityLog.rows.find((x) => x.idempotencyKey === 'race')).toMatchObject({ durationSec: 5, apiKeyId: other.id });
  });

  it('games 행이 없는 GameCode는 game_id null로 저장', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    await linkedMember(t, 'a', { discordId: DISCORD_ID });
    t.prisma.game.rows = t.prisma.game.rows.filter((g) => g.code !== 'tft');
    const r = await send(t, k.raw, [voice('tft1', { game: 'tft', type: 'play' })]);
    expect(r.results[0]?.status).toBe('created');
    expect(t.prisma.activityLog.rows[0]?.gameId).toBeNull();
  });
});
