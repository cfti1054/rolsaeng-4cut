import { describe, expect, it } from 'vitest';
import { ExternalApiError } from '../../src/integrations/contracts';
import { HostRateLimiter } from '../../src/integrations/rate-limiter';
import { RiotHttpApi } from '../../src/integrations/riot/riot-client';
import { FAKE_PUUID, fakeClock, fakeFetch, fixture, testOptions } from '../support/integration-helpers';

function make(routes: Parameters<typeof fakeFetch>[0], over = {}) {
  const clock = fakeClock();
  const fetchFn = fakeFetch(routes);
  const opts = testOptions(over);
  const limiter = new HostRateLimiter(opts.ratePerSec, opts.ratePer2Min, clock);
  return { api: new RiotHttpApi(opts, limiter, fetchFn, clock), fetchFn, clock, limiter };
}

async function kindOf(p: Promise<unknown>): Promise<ExternalApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ExternalApiError);
    return e as ExternalApiError;
  }
  throw new Error('오류가 나야 함');
}

describe('RiotHttpApi 경로·라우팅', () => {
  it('Account-V1 은 asia, 이름·태그는 URL 인코딩, 키는 헤더로', async () => {
    const { api, fetchFn } = make({ '/riot/account/v1/accounts/by-riot-id/': { body: fixture('riot/account.json') } });
    const acc = await api.getAccountByRiotId('테스트 소환사', 'KR1', 'interactive');
    expect(acc.tagLine).toBe('KR1');
    const call = fetchFn.calls[0]!;
    expect(call.url).toBe(
      `https://asia.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent('테스트 소환사')}/KR1`,
    );
    expect((call.init?.headers as Record<string, string>)['X-Riot-Token']).toBe('test-riot-key');
    expect(call.url).not.toContain('test-riot-key');
  });

  it('라우팅은 설정값을 따른다(regional=europe, platform=jp1)', async () => {
    const { api, fetchFn } = make(
      { '/lol/summoner/v4/': { body: fixture('riot/summoner.json') } },
      { regionalRouting: 'europe', platformRouting: 'jp1' },
    );
    expect((await api.getSummonerByPuuid(FAKE_PUUID, 'interactive')).profileIconId).toBe(7);
    expect(fetchFn.calls[0]!.url).toMatch(/^https:\/\/jp1\.api\.riotgames\.com\/lol\/summoner\/v4\/summoners\/by-puuid\//);
  });

  it('League-V4 / TFT-League 경로(TFT 는 /tft/league/v1/by-puuid)와 터보 항목 허용', async () => {
    const { api, fetchFn } = make({
      '/lol/league/v4/entries/by-puuid/': { body: fixture('riot/league-lol-gold.json') },
      '/tft/league/v1/by-puuid/': { body: fixture('riot/league-tft.json') },
    });
    const lol = await api.getLolLeagueEntries(FAKE_PUUID);
    expect(lol.find((e) => e.queueType === 'RANKED_SOLO_5x5')?.tier).toBe('GOLD');
    const tft = await api.getTftLeagueEntries(FAKE_PUUID);
    expect(tft).toHaveLength(2);
    expect(fetchFn.calls[1]!.url).toContain('https://kr.api.riotgames.com/tft/league/v1/by-puuid/');
  });

  it('Match-V5 ids 는 queue=420&type=ranked&count=20, 상세는 gameDuration 을 초로 정규화', async () => {
    const { api, fetchFn } = make({
      '/ids': { body: fixture('riot/match-ids.json') },
      '/matches/KR_9000000001': { body: fixture('riot/match-KR_9000000001.json') },
      '/matches/KR_9000000002': { body: fixture('riot/match-KR_9000000002.json') },
    });
    expect(await api.getLolMatchIds(FAKE_PUUID, { queue: 420, count: 20 })).toHaveLength(2);
    expect(fetchFn.calls[0]!.url).toContain('?queue=420&type=ranked&count=20');
    expect(fetchFn.calls[0]!.url).toContain('https://asia.api.riotgames.com/lol/match/v5/matches/by-puuid/');
    const m1 = await api.getLolMatch('KR_9000000001');
    expect(m1.gameDuration).toBe(1830);
    expect(m1.gameEndTimestamp).toBe(1700001830000);
    // gameEndTimestamp 없는 옛 응답: 밀리초 → 초
    const m2 = await api.getLolMatch('KR_9000000002');
    expect(m2.gameDuration).toBe(1500);
    expect(m2.gameEndTimestamp).toBeNull();
  });
});

describe('RiotHttpApi 오류 분류', () => {
  it('키가 없으면 not_configured (호출하지 않음)', async () => {
    const { api, fetchFn } = make({}, { riotApiKey: undefined });
    expect((await kindOf(api.getAccountByRiotId('a', 'b', 'interactive'))).kind).toBe('not_configured');
    expect(fetchFn.calls).toHaveLength(0);
  });

  it('404 → not_found', async () => {
    const { api } = make({ '/by-riot-id/': { status: 404, body: fixture('riot/error-404.json') } });
    expect((await kindOf(api.getAccountByRiotId('a', 'b', 'interactive'))).kind).toBe('not_found');
  });

  it('401·403 → auth, 재시도 없음', async () => {
    for (const status of [401, 403]) {
      const { api, fetchFn } = make({ '/by-puuid/': { status, body: fixture('riot/error-403.json') } });
      expect((await kindOf(api.getLolLeagueEntries(FAKE_PUUID))).kind).toBe('auth');
      expect(fetchFn.calls).toHaveLength(1);
    }
  });

  it('응답 형식이 다르면 bad_response', async () => {
    const { api } = make({ '/by-puuid/': { body: '{"x":1}' } });
    expect((await kindOf(api.getSummonerByPuuid(FAKE_PUUID, 'background'))).kind).toBe('bad_response');
  });

  it('429 → rate_limited(Retry-After), 호스트를 멈추고 즉시 재시도하지 않는다', async () => {
    const { api, fetchFn, limiter } = make({
      '/lol/league/': { status: 429, headers: { 'Retry-After': '7' }, body: fixture('riot/error-429.json') },
    });
    const e = await kindOf(api.getLolLeagueEntries(FAKE_PUUID));
    expect(e.kind).toBe('rate_limited');
    expect(e.retryAfterSec).toBe(7);
    expect(fetchFn.calls).toHaveLength(1);
    expect(limiter.pausedForMs('kr.api.riotgames.com')).toBe(7000);
    // 멈춘 동안 요청 처리 중 호출은 호출 없이 바로 rate_limited(남은 초)
    const e2 = await kindOf(api.getSummonerByPuuid(FAKE_PUUID, 'interactive'));
    expect(e2.kind).toBe('rate_limited');
    expect(e2.retryAfterSec).toBe(7);
    expect(fetchFn.calls).toHaveLength(1);
    // regional 호스트는 영향 없음
    expect(limiter.pausedForMs('asia.api.riotgames.com')).toBe(0);
  });

  it('429 에 Retry-After 가 없으면 60초', async () => {
    const { api } = make({ '/lol/league/': { status: 429 } });
    expect((await kindOf(api.getLolLeagueEntries(FAKE_PUUID))).retryAfterSec).toBe(60);
  });

  it('background: 5xx 는 1·2·4초 백오프로 3번 다시 시도한 뒤 unavailable', async () => {
    const { api, fetchFn, clock } = make({ '/lol/league/': { status: 503 } });
    expect((await kindOf(api.getLolLeagueEntries(FAKE_PUUID))).kind).toBe('unavailable');
    expect(fetchFn.calls).toHaveLength(4);
    expect(clock.slept.filter((ms) => [1000, 2000, 4000].includes(ms))).toEqual([1000, 2000, 4000]);
  });

  it('background: 중간에 성공하면 그 결과를 쓴다', async () => {
    const { api, fetchFn } = make({
      '/lol/league/': [{ status: 500 }, { body: fixture('riot/league-empty.json') }],
    });
    expect(await api.getLolLeagueEntries(FAKE_PUUID)).toEqual([]);
    expect(fetchFn.calls).toHaveLength(2);
  });

  it('interactive: 5xx 는 1회만 다시 시도', async () => {
    const { api, fetchFn } = make({ '/lol/summoner/': { status: 502 } });
    expect((await kindOf(api.getSummonerByPuuid(FAKE_PUUID, 'interactive'))).kind).toBe('unavailable');
    expect(fetchFn.calls).toHaveLength(2);
  });

  it('타임아웃 → unavailable', async () => {
    const { api } = make({ '/by-puuid/': 'hang' }, { timeoutMs: 20 });
    const e = await kindOf(api.getAccountByPuuid(FAKE_PUUID, 'interactive'));
    expect(e.kind).toBe('unavailable');
    expect(e.message).toBe('timeout');
  });

  it('네트워크 오류 → unavailable, 메시지에 키·URL 이 없다', async () => {
    const { api } = make({ '/by-puuid/': 'network-error' });
    const e = await kindOf(api.getAccountByPuuid(FAKE_PUUID, 'interactive'));
    expect(e.kind).toBe('unavailable');
    expect(e.message).not.toContain('test-riot-key');
    expect(e.message).not.toContain(FAKE_PUUID);
  });
});
