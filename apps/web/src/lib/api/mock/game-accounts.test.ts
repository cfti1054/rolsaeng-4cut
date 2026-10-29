import {
  ApiPath,
  ConfirmRiotVerificationResponse,
  GetMyGameAccountsResponse,
  GetUserProfileResponse,
  LinkGameAccountResponse,
  SetPrimaryGameAccountResponse,
  SyncGameAccountResponse,
  fillPath,
} from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client';
import { createMockBackend, type MockDb } from './backend';
import { MOCK_OTHER_MEMBER_ID } from './game-accounts';

/** S1 목이 계약을 지키는지: 실제 클라이언트(zod 파싱)로 호출한다. 파싱이 실패하면 INVALID_RESPONSE로 터진다 */
function setup(opts: { riotAccountsMax?: number; riotConfigured?: boolean } = {}) {
  let db: MockDb | null = null;
  let now = Date.parse('2026-10-28T03:00:00.000Z'); // KST 12:00
  const mock = createMockBackend({
    storage: { get: () => db, set: (d) => (db = d) },
    cookies: { hasRefresh: () => true, setRefresh: () => {}, clearRefresh: () => {} },
    now: () => now,
    s1: { origin: () => 'http://localhost:3000', ...opts },
  });
  const me = mock.discordSignIn();
  const api = createApiClient({ fetch: mock.fetch });
  const list = () => api.request(ApiPath.myGameAccounts, GetMyGameAccountsResponse);
  const link = (riot_id: string) =>
    api.request(ApiPath.myGameAccounts, LinkGameAccountResponse, { method: 'POST', body: { provider: 'riot', riot_id } });
  const confirm = (id: string) =>
    api.request(fillPath(ApiPath.riotVerificationConfirm, { id }), ConfirmRiotVerificationResponse, { method: 'POST' });
  const advance = (ms: number) => (now += ms);

  /** 소유 확인까지 끝내 라이엇 ID 하나를 연동(첫 확인은 일부러 실패하는 목 규칙 포함) */
  async function linkRiot(riotId: string) {
    const r = await link(riotId);
    if (r.provider !== 'riot') throw new Error('riot');
    await expect(confirm(r.verification.id)).rejects.toMatchObject({ code: 'OWNERSHIP_CHECK_FAILED' });
    advance(5_000);
    return confirm(r.verification.id);
  }
  return { api, me, list, link, confirm, advance, linkRiot };
}

describe('S1 목 백엔드(계약 파싱 통과)', () => {
  it('빈 목록: accounts [], 확인 없음, 남은 횟수 5, limits', async () => {
    const { list } = setup();
    const r = await list();
    expect(r).toMatchObject({ accounts: [], riot_verification: null, limits: { riot_accounts_max: 3, steam_accounts_max: 1 } });
    expect(r.sync_quota).toEqual({ limit: 5, used: 0, remaining: 5, resets_at: '2026-10-29T00:00:00.000+09:00' });
  });

  it('라이엇: 시작 → 불일치 → 5초 간격 RATE_LIMITED(Retry-After) → 성공 → 첫 계정 대표 → 동기화 진행', async () => {
    const { list, link, confirm, advance } = setup();
    const r = await link('새벽감자#KR1');
    expect(r.provider).toBe('riot');
    if (r.provider !== 'riot') return;
    expect((await list()).riot_verification?.id).toBe(r.verification.id);

    await expect(confirm(r.verification.id)).rejects.toMatchObject({ code: 'OWNERSHIP_CHECK_FAILED', status: 409 });
    advance(2_000);
    await expect(confirm(r.verification.id)).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterSec: 3 });
    advance(3_000);
    const ok = await confirm(r.verification.id);
    expect(ok.accounts.map((a) => [a.game, a.is_primary, a.sync.state])).toEqual([
      ['lol', true, 'queued'],
      ['tft', true, 'queued'],
    ]);
    // 멱등
    await expect(confirm(r.verification.id)).resolves.toMatchObject({ verification: { status: 'verified' } });

    advance(3_100);
    const after = await list();
    expect(after.riot_verification).toBeNull();
    expect(after.accounts.every((a) => a.sync.state === 'idle' && a.sync.synced_at !== null)).toBe(true);
    expect(after.accounts[0]!.sync.matches_synced_at).not.toBeNull();
    expect(after.accounts[1]!.sync.matches_synced_at).toBeNull(); // P6: tft 행은 null
  });

  it('제한 시간이 지나면 목록은 expired로 보이고 확인은 OWNERSHIP_CHECK_EXPIRED', async () => {
    const { list, link, confirm, advance } = setup();
    const r = await link('a#1');
    if (r.provider !== 'riot') return;
    advance(600_000);
    expect((await list()).riot_verification?.status).toBe('expired');
    await expect(confirm(r.verification.id)).rejects.toMatchObject({ code: 'OWNERSHIP_CHECK_EXPIRED', status: 410 });
  });

  it('다른 아이콘 받기(D65): 같은 라이엇 ID로 다시 시작하면 이전 확인은 취소되고 다른 아이콘', async () => {
    const { list, link, confirm } = setup();
    const a = await link('a#1');
    const b = await link('a#1');
    if (a.provider !== 'riot' || b.provider !== 'riot') return;
    expect(b.verification.icon_id).not.toBe(a.verification.icon_id);
    expect((await list()).riot_verification?.id).toBe(b.verification.id);
    await expect(confirm(a.verification.id)).rejects.toMatchObject({ code: 'OWNERSHIP_CHECK_EXPIRED' });
  });

  it('오류 구분: 형식 → VALIDATION_FAILED, 없는 ID, 다른 멤버, 내가 이미 연동, 한도', async () => {
    const { link, linkRiot } = setup({ riotAccountsMax: 2 });
    await expect(link('이름만')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(link('notfound#KR1')).rejects.toMatchObject({ code: 'RIOT_ID_NOT_FOUND' });
    await expect(link('taken#KR1')).rejects.toMatchObject({ code: 'GAME_ACCOUNT_ALREADY_LINKED' });
    await expect(link('nosummoner#KR1')).rejects.toMatchObject({ code: 'RIOT_SUMMONER_NOT_FOUND' });
    await expect(link('busy#KR1')).rejects.toMatchObject({ code: 'GAME_PROVIDER_RATE_LIMITED', retryAfterSec: 30 });
    await linkRiot('main#KR1');
    await expect(link('MAIN#kr1')).rejects.toMatchObject({ code: 'GAME_ACCOUNT_ALREADY_LINKED_TO_ME' });
    await linkRiot('sub#KR1');
    await expect(link('third#KR1')).rejects.toMatchObject({ code: 'GAME_ACCOUNT_LIMIT_REACHED' });
  });

  it('제공자 키 없음 → GAME_PROVIDER_NOT_CONFIGURED', async () => {
    const { link } = setup({ riotConfigured: false });
    await expect(link('a#1')).rejects.toMatchObject({ code: 'GAME_PROVIDER_NOT_CONFIGURED', status: 503 });
  });

  it('부계정 → 대표 지정 → 대표 해제 시 가장 먼저 연동한 남은 계정 승격', async () => {
    const { api, list, linkRiot, advance } = setup();
    await linkRiot('main#1');
    advance(1_000);
    const sub = await linkRiot('sub#1');
    expect(sub.accounts.every((a) => !a.is_primary)).toBe(true);
    advance(1_000);
    await linkRiot('third#1');

    const set = await api.request(fillPath(ApiPath.myGameAccountPrimary, { id: sub.accounts[1]!.id }), SetPrimaryGameAccountResponse, {
      method: 'POST',
    });
    expect(set.accounts.slice(0, 2).map((a) => [a.display_name, a.is_primary])).toEqual([
      ['sub#1', true],
      ['sub#1', true],
    ]);
    expect(set.accounts.filter((a) => a.is_primary)).toHaveLength(2);

    await api.request(fillPath(ApiPath.myGameAccount, { id: sub.accounts[0]!.id }), null, { method: 'DELETE' });
    const after = await list();
    expect(after.accounts.map((a) => a.display_name)).toEqual(['main#1', 'main#1', 'third#1', 'third#1']);
    expect(after.accounts[0]!.is_primary).toBe(true);
  });

  it('스팀: authorize_url은 /settings?steam=linked, 첫 동기화는 비공개, 다시 시도하면 성공', async () => {
    const { api, list, advance } = setup();
    const r = await api.request(ApiPath.myGameAccounts, LinkGameAccountResponse, { method: 'POST', body: { provider: 'steam' } });
    expect(r).toEqual({ provider: 'steam', authorize_url: 'http://localhost:3000/settings?steam=linked' });
    await expect(
      api.request(ApiPath.myGameAccounts, LinkGameAccountResponse, { method: 'POST', body: { provider: 'steam' } }),
    ).rejects.toMatchObject({ code: 'GAME_ACCOUNT_LIMIT_REACHED' });
    advance(3_100);
    const steam = (await list()).accounts[0]!;
    expect(steam.sync.error?.code).toBe('STEAM_PROFILE_PRIVATE');
    expect(steam.sync.synced_at).toBeNull();

    const s = await api.request(fillPath(ApiPath.myGameAccountSync, { id: steam.id }), SyncGameAccountResponse, { method: 'POST' });
    expect(s).toMatchObject({ quota_consumed: true, sync_quota: { remaining: 4 } });
    advance(3_100);
    const done = (await list()).accounts[0]!;
    expect(done).toMatchObject({ steam_owned_game_count: 84, sync: { error: null } });
  });

  it('수동 새로고침: 진행 중이면 미차감, 하루 5회 넘으면 SYNC_LIMIT_EXCEEDED + 자정까지 Retry-After', async () => {
    const { api, linkRiot, advance } = setup();
    const ok = await linkRiot('a#1');
    const id = ok.accounts[0]!.id;
    const sync = () => api.request(fillPath(ApiPath.myGameAccountSync, { id }), SyncGameAccountResponse, { method: 'POST' });
    await expect(sync()).resolves.toMatchObject({ quota_consumed: false, sync_quota: { used: 0 } }); // 연동 직후 queued
    for (let i = 0; i < 5; i += 1) {
      advance(3_100);
      await expect(sync()).resolves.toMatchObject({ quota_consumed: true, sync_quota: { used: i + 1 } });
    }
    advance(3_100);
    await expect(sync()).rejects.toMatchObject({ code: 'SYNC_LIMIT_EXCEEDED', status: 429 });
    try {
      await sync();
    } catch (e) {
      // 03:00Z + 6×3.1초 = KST 12:00:18.6 → 자정까지 약 12시간
      expect((e as { retryAfterSec: number }).retryAfterSec).toBeGreaterThan(11 * 3600);
      expect((e as { retryAfterSec: number }).retryAfterSec).toBeLessThanOrEqual(12 * 3600);
    }
  });

  it('프로필: 본인(빈 상태) → 연동 후 대표 기준 티어·전적, 다른 멤버는 sync_quota null, 없는 id NOT_FOUND', async () => {
    const { api, me, linkRiot, advance } = setup();
    const profile = (id: string) => api.request(fillPath(ApiPath.userProfile, { id }), GetUserProfileResponse);

    const empty = await profile(me.id);
    expect(empty).toMatchObject({
      is_self: true,
      game_accounts: [],
      tiers: [],
      main_position: null,
      recent_matches: null,
      scrim: null,
      badges: null,
      user: { discord_linked: true },
    });
    expect(empty.sync_quota).not.toBeNull();

    await linkRiot('main#1');
    const queued = await profile(me.id);
    expect(queued.tiers.map((t) => [t.game, t.rank])).toEqual([
      ['lol', null],
      ['tft', null],
    ]);
    expect(queued.recent_matches).toMatchObject({ items: [], refresh_queued: true });

    advance(3_100);
    const ready = await profile(me.id);
    expect(ready.tiers.every((t) => t.rank !== null)).toBe(true);
    expect(ready.recent_matches?.items.length).toBe(10);
    expect(ready.main_position?.source).toBe('riot_ranked_solo');

    const other = await profile(MOCK_OTHER_MEMBER_ID);
    expect(other).toMatchObject({ is_self: false, sync_quota: null });
    expect(other.game_accounts.map((a) => a.display_name)).toEqual(['정글차이#KR2', '정글차이#KR2', '정글부캐#0001', '정글부캐#0001']);
    expect(JSON.stringify(other)).not.toMatch(/"(key|private_left|sync_state_at)":/); // 목 내부 필드 비노출

    await expect(profile('00000000-0000-4000-8000-00000000ffff')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(profile('not-a-uuid')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
