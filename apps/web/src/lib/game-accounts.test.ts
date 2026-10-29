import { GetMyGameAccountsResponse } from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import { formatCountdown } from './format';
import {
  SYNC_POLL_INTERVAL_MS,
  SYNC_POLL_MAX_MS,
  applyPrimary,
  groupRiotAccounts,
  hasSteamCallbackKeys,
  isVerificationExpired,
  nextPollInterval,
  parseSteamCallbackQuery,
  riotAddState,
  unlinkPromotes,
  verificationRemainingSec,
} from './game-accounts';
import { account, listResponse, riotPair } from './test-fixtures';

const T0 = Date.parse('2026-10-28T12:00:00.000Z');

describe('라이엇 카드 묶기(groupRiotAccounts)', () => {
  it('라이엇 ID마다 lol·tft 두 행 → 카드 1장, 정렬 유지, 스팀 제외, 동기화 정보는 lol 행 기준(P6)', () => {
    const [mainLol, mainTft] = riotPair('새벽감자#KR1', { is_primary: true });
    const lolSync = { state: 'idle' as const, synced_at: '2026-10-28T11:00:00.000Z', matches_synced_at: '2026-10-28T11:00:00.000Z', error: null };
    mainLol.sync = lolSync;
    mainLol.rank = { tier: 'EMERALD', division: 'III', lp: 12, wins: 1, losses: 2 };
    mainTft.rank = { tier: 'MASTER', division: null, lp: 3, wins: 4, losses: 5 };
    const sub = riotPair('감자튀김#0101');
    const steam = account({ game: 'steam', display_name: 'potato' });
    const groups = groupRiotAccounts([mainLol, mainTft, ...sub, steam]);
    expect(groups.map((g) => g.display_name)).toEqual(['새벽감자#KR1', '감자튀김#0101']);
    expect(groups[0]).toMatchObject({ id: mainLol.id, is_primary: true, sync: lolSync });
    expect(groups[0]!.lolRank?.tier).toBe('EMERALD');
    expect(groups[0]!.tftRank?.tier).toBe('MASTER');
    expect(groups[1]!.is_primary).toBe(false);
  });
  it('tft 행이 먼저 와도 카드 id는 lol 행 id', () => {
    const [lol, tft] = riotPair('a#1');
    expect(groupRiotAccounts([tft, lol])[0]!.id).toBe(lol.id);
  });
});

describe('「+ 부계정 추가」 상태(D58, limits.riot_accounts_max)', () => {
  it('없음 → first, 1개 → more, 한도 도달 → full', () => {
    expect(riotAddState(listResponse([]))).toBe('first');
    expect(riotAddState(listResponse(riotPair('a#1', { is_primary: true })))).toBe('more');
    const three = [...riotPair('a#1'), ...riotPair('b#1'), ...riotPair('c#1')];
    expect(riotAddState(listResponse(three))).toBe('full');
  });
  it('한도는 응답 limits 값을 따른다(3 고정 아님)', () => {
    const two = [...riotPair('a#1'), ...riotPair('b#1')];
    expect(riotAddState(listResponse(two, { limits: { riot_accounts_max: 2, steam_accounts_max: 1 } }))).toBe('full');
    expect(riotAddState(listResponse(two, { limits: { riot_accounts_max: 5, steam_accounts_max: 1 } }))).toBe('more');
  });
  it('진행 중 확인이 있으면 verifying(추가 버튼 대신 확인 카드)', () => {
    const v = {
      id: '11111111-1111-4111-8111-111111111111',
      display_name: 'a#1',
      icon_id: 7,
      icon_image_url: null,
      status: 'pending' as const,
      expires_at: '2026-10-28T12:10:00.000Z',
      created_at: '2026-10-28T12:00:00.000Z',
    };
    expect(riotAddState(listResponse([], { riot_verification: v }))).toBe('verifying');
  });
});

describe('소유 확인 남은 시간', () => {
  const v = { expires_at: new Date(T0 + 600_000).toISOString(), status: 'pending' as const };
  it('남은 초(올림)와 mm:ss 표기', () => {
    expect(verificationRemainingSec(v, T0)).toBe(600);
    expect(formatCountdown(verificationRemainingSec(v, T0))).toBe('10:00');
    expect(verificationRemainingSec(v, T0 + 78_000)).toBe(522);
    expect(verificationRemainingSec(v, T0 + 78_000 - 1)).toBe(523);
    expect(formatCountdown(522)).toBe('08:42');
    expect(verificationRemainingSec(v, T0 + 599_001)).toBe(1);
  });
  it('0이 되거나 지나면 0, 만료로 본다', () => {
    expect(verificationRemainingSec(v, T0 + 600_000)).toBe(0);
    expect(verificationRemainingSec(v, T0 + 999_000)).toBe(0);
    expect(formatCountdown(-5)).toBe('00:00');
    expect(isVerificationExpired(v, T0 + 600_000)).toBe(true);
    expect(isVerificationExpired(v, T0 + 599_000)).toBe(false);
  });
  it('서버가 expired로 내려주면 시간이 남아도 만료', () => {
    expect(isVerificationExpired({ ...v, status: 'expired' }, T0)).toBe(true);
  });
});

describe('대표 지정 낙관적 갱신(applyPrimary)', () => {
  it('대상 라이엇 ID의 lol·tft만 true, 나머지 라이엇 false, 스팀 유지, 대표가 맨 앞으로', () => {
    const main = riotPair('main#1', { is_primary: true, verified_at: '2026-10-01T00:00:00.000Z' });
    const sub1 = riotPair('sub1#1', { verified_at: '2026-10-02T00:00:00.000Z' });
    const sub2 = riotPair('sub2#1', { verified_at: '2026-10-03T00:00:00.000Z' });
    const steam = account({ game: 'steam', display_name: 'st' });
    const before = listResponse([...main, ...sub1, ...sub2, steam]);
    const after = applyPrimary(before, sub2[1].id); // tft 행 id로 지정해도 같은 라이엇 ID 전체
    expect(after.accounts.map((a) => `${a.display_name}:${a.game}:${a.is_primary}`)).toEqual([
      'sub2#1:lol:true',
      'sub2#1:tft:true',
      'main#1:lol:false',
      'main#1:tft:false',
      'sub1#1:lol:false',
      'sub1#1:tft:false',
      'st:steam:true',
    ]);
    expect(GetMyGameAccountsResponse.safeParse(after).success).toBe(true);
    // 원본은 바뀌지 않는다(롤백용 스냅샷)
    expect(before.accounts[0]!.is_primary).toBe(true);
  });
  it('모르는 id·스팀 id는 그대로', () => {
    const data = listResponse([...riotPair('a#1', { is_primary: true }), account({ game: 'steam', display_name: 's' })]);
    expect(applyPrimary(data, 'nope')).toBe(data);
    expect(applyPrimary(data, data.accounts[2]!.id)).toBe(data);
  });
});

describe('대표 해제 시 승격 안내(unlinkPromotes)', () => {
  it('대표를 해제하면 가장 먼저 연동한 부계정, 부계정 해제·마지막 하나는 null', () => {
    const groups = groupRiotAccounts([
      ...riotPair('main#1', { is_primary: true, verified_at: '2026-10-01T00:00:00.000Z' }),
      ...riotPair('late#1', { verified_at: '2026-10-05T00:00:00.000Z' }),
      ...riotPair('early#1', { verified_at: '2026-10-02T00:00:00.000Z' }),
    ]);
    expect(unlinkPromotes(groups, groups[0]!.id)?.display_name).toBe('early#1');
    expect(unlinkPromotes(groups, groups[1]!.id)).toBeNull();
    expect(unlinkPromotes(groups.slice(0, 1), groups[0]!.id)).toBeNull();
  });
});

describe('동기화 폴링(계약 6-1)', () => {
  const idle = riotPair('a#1');
  const busy = riotPair('a#1', { sync: { state: 'queued', synced_at: null, matches_synced_at: null, error: null } });
  it('모두 idle이면 멈춤', () => {
    expect(nextPollInterval(idle, null, T0)).toEqual([false, null]);
    expect(nextPollInterval(undefined, 123, T0)).toEqual([false, null]);
  });
  it('진행 중이면 2초 간격, 처음 본 시각부터 60초가 지나면 멈춤', () => {
    expect(nextPollInterval(busy, null, T0)).toEqual([SYNC_POLL_INTERVAL_MS, T0]);
    expect(nextPollInterval(busy, T0, T0 + SYNC_POLL_MAX_MS - 1)).toEqual([SYNC_POLL_INTERVAL_MS, T0]);
    expect(nextPollInterval(busy, T0, T0 + SYNC_POLL_MAX_MS)).toEqual([false, T0]);
  });
});

describe('스팀 콜백 쿼리', () => {
  it('steam=linked → linked', () => {
    expect(parseSteamCallbackQuery('?steam=linked')).toEqual({ kind: 'linked' });
  });
  it('steam_error=허용 코드 → error', () => {
    expect(parseSteamCallbackQuery('?steam_error=STEAM_LINK_CANCELLED')).toEqual({ kind: 'error', code: 'STEAM_LINK_CANCELLED' });
    expect(parseSteamCallbackQuery(new URLSearchParams({ steam_error: 'GAME_ACCOUNT_ALREADY_LINKED' }))).toEqual({
      kind: 'error',
      code: 'GAME_ACCOUNT_ALREADY_LINKED',
    });
  });
  it('알 수 없는 값·목록 밖 코드는 무시(null), 다른 쿼리 키는 영향 없음', () => {
    expect(parseSteamCallbackQuery('?steam=yes')).toBeNull();
    expect(parseSteamCallbackQuery('?steam_error=NICKNAME_TAKEN')).toBeNull();
    expect(parseSteamCallbackQuery('?steam_error=<script>')).toBeNull();
    expect(parseSteamCallbackQuery('')).toBeNull();
    expect(parseSteamCallbackQuery('?steam=linked&utm=x')).toEqual({ kind: 'linked' });
  });
  it('잘못된 값이어도 쿼리 정리 대상인지는 따로 판단', () => {
    expect(hasSteamCallbackKeys('?steam=yes')).toBe(true);
    expect(hasSteamCallbackKeys('?tab=x')).toBe(false);
  });
});
