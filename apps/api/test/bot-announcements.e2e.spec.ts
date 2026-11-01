/**
 * S6 봇 공지·패치노트 전송 4개 HTTP 테스트(DB 없이, 계약 S6 8-4·18절 backend 「봇」). 고정 시계 2026-10-31T03:00Z.
 */
import {
  BotPendingNotice,
  GetBotPendingNoticesResponse,
  GetBotPendingPatchNotesResponse,
  PostBotDeliveredResponse,
} from '@gcd/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { call, expectError } from './support/s1-helpers';
import { login } from './support/s4-helpers';
import { bot, linkedMember, seedApiKey } from './support/s5-helpers';
import { HOUR, MIN, json } from './support/s6-helpers';
import { TEST_WEB_ORIGIN, type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const NOW = '2026-10-31T03:00:00.000Z';
const nowMs = Date.parse(NOW);

async function setup() {
  t = await createTestApp({ fixedClock: NOW });
  const author = await linkedMember(t, '공지작성자');
  const key = seedApiKey(t);
  return { app: t, author, key };
}

function seedNotice(app: TestApp, authorId: string, o: { title?: string; notify?: boolean; createdAt: number; notifiedAt?: Date | null }) {
  return app.prisma.notice.insert({
    title: o.title ?? '공지',
    body: '본문',
    authorId,
    notifyDiscord: o.notify ?? true,
    discordNotifiedAt: o.notifiedAt ?? null,
    createdAt: new Date(o.createdAt),
  });
}

function seedPatch(app: TestApp, o: { title?: string; notify?: boolean; createdAt: number; notifiedAt?: Date | null }) {
  return app.prisma.patchNote.insert({
    gameId: app.prisma.gameId('lol'),
    title: o.title ?? '패치',
    summary: '요약',
    publishedOn: new Date('2026-10-30T00:00:00.000Z'),
    notifyDiscord: o.notify ?? true,
    discordNotifiedAt: o.notifiedAt ?? null,
    createdAt: new Date(o.createdAt),
  });
}

describe('GET /bot/notices/pending · POST /bot/notices/:id/delivered', () => {
  it('대기 조건(notify·미전송·72시간 경계)·정렬 created_at ASC·작성자 BotUserRef·web_url', async () => {
    const { app, author, key } = await setup();
    const edge = seedNotice(app, author.id, { title: '정확히 72시간', createdAt: nowMs - 72 * HOUR });
    seedNotice(app, author.id, { title: '72시간 넘음', createdAt: nowMs - 72 * HOUR - 1 });
    seedNotice(app, author.id, { title: '알림 끔', notify: false, createdAt: nowMs - HOUR });
    seedNotice(app, author.id, { title: '이미 보냄', createdAt: nowMs - HOUR, notifiedAt: new Date(nowMs - MIN) });
    const recent = seedNotice(app, author.id, { title: '방금', createdAt: nowMs - MIN });

    const body = GetBotPendingNoticesResponse.parse(await json(await bot(app, 'GET', '/bot/notices/pending', key.raw)));
    expect(body.items.map((i) => i.id)).toEqual([edge.id, recent.id]);
    expect(body.next_cursor).toBeNull();
    expect(body.generated_at).toBe(NOW);
    const first = BotPendingNotice.parse(body.items[0]);
    expect(first.author).toMatchObject({ id: author.id, discord_id: author.discordId, profile_url: `${TEST_WEB_ORIGIN}/members/${author.id}` });
    expect(first.web_url).toBe(`${TEST_WEB_ORIGIN}/news`);
  });

  it('delivered 멱등(delivered → already_delivered 같은 시각), notify 꺼진 뒤에도 기록, 없음 404, 본문 검사', async () => {
    const { app, author, key } = await setup();
    const n = seedNotice(app, author.id, { createdAt: nowMs - MIN });
    const r1 = PostBotDeliveredResponse.parse(await json(await bot(app, 'POST', `/bot/notices/${n.id}/delivered`, key.raw, {})));
    expect(r1).toEqual({ id: n.id, status: 'delivered', discord_notified_at: NOW });
    app.clock.advance(MIN);
    const r2 = PostBotDeliveredResponse.parse(await json(await bot(app, 'POST', `/bot/notices/${n.id}/delivered`, key.raw)));
    expect(r2).toEqual({ id: n.id, status: 'already_delivered', discord_notified_at: NOW });
    expect(GetBotPendingNoticesResponse.parse(await json(await bot(app, 'GET', '/bot/notices/pending', key.raw))).items).toHaveLength(0);

    const off = seedNotice(app, author.id, { notify: false, createdAt: nowMs });
    expect(PostBotDeliveredResponse.parse(await json(await bot(app, 'POST', `/bot/notices/${off.id}/delivered`, key.raw, {}))).status).toBe('delivered');

    await expectError(await bot(app, 'POST', '/bot/notices/00000000-0000-4000-8000-000000000001/delivered', key.raw, {}), 404, 'NOT_FOUND');
    await expectError(await bot(app, 'POST', `/bot/notices/${n.id}/delivered`, key.raw, { x: 1 }), 400, 'VALIDATION_FAILED');
    await expectError(await bot(app, 'POST', '/bot/notices/abc/delivered', key.raw, {}), 400, 'VALIDATION_FAILED');
  });

  it('scope: bot:notices 없는 키 403, 폐기 키·키 없음 401, JWT로는 401(봇 키 아님)', async () => {
    const { app, author } = await setup();
    const n = seedNotice(app, author.id, { createdAt: nowMs });
    const patchOnly = seedApiKey(app, { scopes: ['bot:patch-notes'] });
    await expectError(await bot(app, 'GET', '/bot/notices/pending', patchOnly.raw), 403, 'API_KEY_SCOPE_MISSING');
    await expectError(await bot(app, 'POST', `/bot/notices/${n.id}/delivered`, patchOnly.raw, {}), 403, 'API_KEY_SCOPE_MISSING');
    const noticeOnly = seedApiKey(app, { scopes: ['bot:notices'] });
    await expectError(await bot(app, 'GET', '/bot/patch-notes/pending', noticeOnly.raw), 403, 'API_KEY_SCOPE_MISSING');
    expect((await bot(app, 'POST', `/bot/notices/${n.id}/delivered`, noticeOnly.raw, {})).status).toBe(200);
    const revoked = seedApiKey(app, { revokedAt: new Date(nowMs - HOUR) });
    await expectError(await bot(app, 'GET', '/bot/notices/pending', revoked.raw), 401, 'API_KEY_INVALID');
    await expectError(await bot(app, 'GET', '/bot/notices/pending', undefined), 401, 'API_KEY_INVALID');
    const admin = await login(app, 'admin_a', 'admin');
    await expectError(await call(app, 'GET', '/bot/notices/pending', admin.token), 401, 'API_KEY_INVALID');
  });
});

describe('GET /bot/patch-notes/pending · POST /bot/patch-notes/:id/delivered', () => {
  it('notify_discord_ids = 연동 && notify_patch && 탈퇴 아님(미연동·설정 꺼짐·탈퇴 제외), 행마다 같은 배열', async () => {
    const { app, key } = await setup();
    const on = await linkedMember(app, '패치구독');
    const off = await linkedMember(app, '패치끔');
    const left = await linkedMember(app, '탈퇴', { leftAt: new Date(nowMs - HOUR) });
    const dev = await login(app, 'dev_user');
    for (const id of [on.id, left.id, dev.userId]) {
      const u = app.prisma.users.find((x) => x.id === id);
      if (u) u.notifyPatch = true;
    }
    void off;
    const p1 = seedPatch(app, { title: '먼저', createdAt: nowMs - 2 * HOUR });
    const p2 = seedPatch(app, { title: '나중', createdAt: nowMs - HOUR });
    seedPatch(app, { title: '오래됨', createdAt: nowMs - 73 * HOUR });
    const body = GetBotPendingPatchNotesResponse.parse(await json(await bot(app, 'GET', '/bot/patch-notes/pending', key.raw)));
    expect(body.items.map((i) => i.id)).toEqual([p1.id, p2.id]);
    expect(body.items[0]).toMatchObject({ game: { code: 'lol' }, published_on: '2026-10-30', web_url: `${TEST_WEB_ORIGIN}/news` });
    expect(body.items[0]?.notify_discord_ids).toEqual([on.discordId]);
    expect(body.items[1]?.notify_discord_ids).toEqual([on.discordId]);

    const d = PostBotDeliveredResponse.parse(await json(await bot(app, 'POST', `/bot/patch-notes/${p1.id}/delivered`, key.raw, {})));
    expect(d.status).toBe('delivered');
    const again = PostBotDeliveredResponse.parse(await json(await bot(app, 'POST', `/bot/patch-notes/${p1.id}/delivered`, key.raw, {})));
    expect(again).toEqual({ id: p1.id, status: 'already_delivered', discord_notified_at: NOW });
    await expectError(await bot(app, 'POST', '/bot/patch-notes/00000000-0000-4000-8000-000000000001/delivered', key.raw, {}), 404, 'NOT_FOUND');
    expect(app.prisma.patchNote.rows.find((r) => r.id === p1.id)?.discordNotifiedAt?.toISOString()).toBe(NOW);
  });
});
