/**
 * S5 PUT /bot/presence(계약 6-7)와 홈 요약 community 블록(8절).
 * DB 없이 FakePrisma. 실제 ON CONFLICT … WHERE 순서 역전은 test/db/bot.db.e2e.spec.ts.
 */
import {
  BOT_PRESENCE_STALE_AFTER_SEC,
  DASHBOARD_NOW_PLAYING_MAX,
  GetDashboardSummaryResponse,
  PutBotPresenceResponse,
} from '@gcd/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, expectError } from './support/s1-helpers';
import { login } from './support/s4-helpers';
import { bot, linkedMember, seedActivity, seedApiKey } from './support/s5-helpers';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
  vi.restoreAllMocks();
});

const NOW = '2026-10-31T12:00:00.000Z'; // 토요일 21:00 KST
const ms = (iso: string) => new Date(iso).getTime();
const iso = (n: number) => new Date(n).toISOString();

async function put(app: TestApp, key: string, body: Record<string, unknown>): Promise<PutBotPresenceResponse> {
  const res = await bot(app, 'PUT', '/bot/presence', key, { voice_member_count: 3, playing: [], ...body });
  const text = await res.text();
  expect({ status: res.status, text }).toMatchObject({ status: 200 });
  return PutBotPresenceResponse.strict().parse(JSON.parse(text));
}

async function community(app: TestApp, token: string) {
  const res = await call(app, 'GET', '/dashboard/summary', token);
  const text = await res.text();
  expect({ status: res.status, text }).toMatchObject({ status: 200 });
  return GetDashboardSummaryResponse.parse(JSON.parse(text)).community;
}

describe('PUT /bot/presence', () => {
  it('수용 → 1행(api_key_id 기록), 더 새 스냅샷 덮어쓰기, 같거나 이른 시각 OLDER_THAN_STORED(덮지 않음)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t, { scopes: ['bot:presence'] });
    const playing = [{ name: 'League of Legends', game: 'lol', steam_app_id: null, count: 8 }];
    expect(await put(t, k.raw, { captured_at: iso(ms(NOW) - 60_000), voice_member_count: 23, playing })).toEqual({
      accepted: true,
      reason: null,
    });
    expect(t.prisma.botPresence.rows).toHaveLength(1);
    expect(t.prisma.botPresence.rows[0]).toMatchObject({ source: 'default', voiceMemberCount: 23, playing, apiKeyId: k.id });
    expect(await put(t, k.raw, { captured_at: iso(ms(NOW) - 60_000), voice_member_count: 1 })).toEqual({
      accepted: false,
      reason: 'OLDER_THAN_STORED',
    });
    expect(await put(t, k.raw, { captured_at: iso(ms(NOW) - 120_000), voice_member_count: 1 })).toMatchObject({
      reason: 'OLDER_THAN_STORED',
    });
    expect(t.prisma.botPresence.rows[0]?.voiceMemberCount).toBe(23);
    expect(await put(t, k.raw, { captured_at: NOW, voice_member_count: 5 })).toEqual({ accepted: true, reason: null });
    expect(t.prisma.botPresence.rows).toHaveLength(1);
    expect(t.prisma.botPresence.rows[0]).toMatchObject({ voiceMemberCount: 5, playing: [], capturedAt: new Date(NOW) });
  });

  it('IN_FUTURE(now + 300초 + 1ms), TOO_OLD(now − 300초 − 1ms), 경계 정확히는 수용', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    const tol = 300_000;
    expect(await put(t, k.raw, { captured_at: iso(ms(NOW) + tol + 1) })).toEqual({ accepted: false, reason: 'IN_FUTURE' });
    expect(await put(t, k.raw, { captured_at: iso(ms(NOW) - tol - 1) })).toEqual({ accepted: false, reason: 'TOO_OLD' });
    expect(t.prisma.botPresence.rows).toHaveLength(0);
    expect((await put(t, k.raw, { captured_at: iso(ms(NOW) - tol) })).accepted).toBe(true);
    expect((await put(t, k.raw, { captured_at: iso(ms(NOW) + tol) })).accepted).toBe(true);
  });

  it('형식 오류 400: 모르는 필드, playing 21행, count 0, 음수 인원', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    const p = { name: 'X', game: null, steam_app_id: null, count: 1 };
    for (const body of [
      { captured_at: NOW, voice_member_count: 1, playing: [], extra: true },
      { captured_at: NOW, voice_member_count: 1, playing: Array.from({ length: 21 }, () => p) },
      { captured_at: NOW, voice_member_count: 1, playing: [{ ...p, count: 0 }] },
      { captured_at: NOW, voice_member_count: -1, playing: [] },
      { captured_at: NOW, voice_member_count: 1, playing: [{ ...p, x: 1 }] },
    ]) {
      await expectError(await bot(t, 'PUT', '/bot/presence', k.raw, body), 400, 'VALIDATION_FAILED');
    }
  });
});

describe('요약 community(8절)', () => {
  it('봇 자료 없음 → voice·active_members not_connected, now_playing null', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    expect(await community(t, me.token)).toEqual({
      voice: { state: 'not_connected', member_count: null, captured_at: null },
      active_members: { state: 'not_connected', count: null },
      now_playing: null,
    });
  });

  it('live(정확히 300초 전) → 숫자, stale(300초 + 1ms) → null + captured_at, now_playing은 live이고 playing 있을 때만', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const k = seedApiKey(t);
    const captured = iso(ms(NOW) - 60_000);
    const playing = [
      { name: 'b', game: null, steam_app_id: null, count: 2 },
      { name: 'League of Legends', game: 'lol', steam_app_id: null, count: 8 },
      { name: 'a', game: null, steam_app_id: null, count: 2 },
      { name: 'PUBG: BATTLEGROUNDS', game: 'steam', steam_app_id: 578080, count: 3 },
      { name: 'c', game: null, steam_app_id: null, count: 1 },
      { name: 'd', game: null, steam_app_id: null, count: 1 },
    ];
    await put(t, k.raw, { captured_at: captured, voice_member_count: 23, playing });
    t.clock.set(iso(ms(captured) + BOT_PRESENCE_STALE_AFTER_SEC * 1000));
    const live = await community(t, me.token);
    const capturedOut = new Date(captured).toISOString();
    expect(live.voice).toEqual({ state: 'live', member_count: 23, captured_at: capturedOut });
    expect(live.active_members).toEqual({ state: 'ready', count: 0 }); // 접속 현황만 있어도 봇 연결됨
    expect(live.now_playing?.captured_at).toBe(capturedOut);
    expect(live.now_playing?.items.map((i) => [i.name, i.count])).toEqual([
      ['League of Legends', 8],
      ['PUBG: BATTLEGROUNDS', 3],
      ['a', 2],
      ['b', 2],
      ['c', 1],
    ]);
    expect(live.now_playing?.items).toHaveLength(DASHBOARD_NOW_PLAYING_MAX);

    t.clock.advance(1);
    const stale = await community(t, me.token);
    expect(stale.voice).toEqual({ state: 'stale', member_count: null, captured_at: capturedOut });
    expect(stale.now_playing).toBeNull();
  });

  it('live인데 playing [] 또는 저장 JSON 형식 불일치 → now_playing null', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const k = seedApiKey(t);
    await put(t, k.raw, { captured_at: NOW, playing: [] });
    expect((await community(t, me.token)).now_playing).toBeNull();
    const row = t.prisma.botPresence.rows[0];
    if (row) row.playing = [{ name: 'x', count: 'many' }];
    const c = await community(t, me.token);
    expect(c.voice.state).toBe('live');
    expect(c.now_playing).toBeNull();
  });

  it('이번 주 활동 멤버: voice·chat만(play만 한 회원 제외, D240)·탈퇴 제외·주 경계(월요일 00:00 KST 포함, 직전 1ms 제외), 활동 기록만 있어도 ready', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const a = await linkedMember(t, 'a');
    const b = await linkedMember(t, 'b');
    const c = await linkedMember(t, 'c');
    const d = await linkedMember(t, 'd');
    const gone = await linkedMember(t, 'gone', { leftAt: new Date('2026-10-30T00:00:00.000Z') });
    const weekStart = '2026-10-25T15:00:00.000Z'; // 10-26(월) 00:00 KST
    // a: chat만(주 시작 시각 포함) → 센다
    seedActivity(t, a.id, { type: 'chat', startedAt: weekStart });
    // d: voice → 센다
    seedActivity(t, d.id, { type: 'voice', startedAt: '2026-10-30T10:00:00.000Z' });
    // b: play만 → 세지 않는다(D240). 행은 저장돼 있다
    seedActivity(t, b.id, { type: 'play', startedAt: '2026-10-31T11:00:00.000Z', game: 'lol', durationSec: 7200 });
    seedActivity(t, c.id, { type: 'voice', startedAt: iso(ms(weekStart) - 1) });
    seedActivity(t, gone.id, { type: 'voice', startedAt: '2026-10-30T10:00:00.000Z' });
    const out = await community(t, me.token);
    expect(out.active_members).toEqual({ state: 'ready', count: 2 });
    expect(t.prisma.activityLog.rows.some((r) => r.userId === b.id && r.type === 'play')).toBe(true);
    // type 목록은 바인딩(문자열 리터럴 없음)
    const sql = t.prisma.rawCalls.find((x) => x.sql.includes('gcd:active-members'));
    expect(sql?.sql).not.toMatch(/'voice'|'chat'|'play'/);
    expect(out.voice.state).toBe('not_connected');
    // 활동 멤버 쿼리가 순위 대상 조건을 쓴다
    expect(t.prisma.rawCalls.some((x) => x.sql.includes('gcd:active-members'))).toBe(true);
  });

  it('community 조회 실패는 요약 전체 500', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    vi.spyOn(t.prisma.botPresence, 'findUnique').mockRejectedValue(new Error('db down'));
    await expectError(await call(t, 'GET', '/dashboard/summary', me.token), 500, 'INTERNAL_ERROR');
  });
});
