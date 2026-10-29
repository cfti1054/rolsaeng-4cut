import { describe, expect, it } from 'vitest';
import { DataDragonHttp } from '../../src/integrations/ddragon';
import { fakeClock, fakeFetch, testOptions } from '../support/integration-helpers';

const champs = JSON.stringify({ data: { Aatrox: { id: 'Aatrox', key: '266', name: '아트록스' } } });

describe('DataDragonHttp', () => {
  it('최신 버전으로 아이콘·챔피언(ko_KR) URL 을 만들고 버전은 캐시', async () => {
    const f = fakeFetch({
      'api/versions.json': { body: '["16.21.1","16.20.1"]' },
      'data/ko_KR/champion.json': { body: champs },
    });
    const dd = new DataDragonHttp(testOptions(), f, fakeClock());
    expect(await dd.profileIconUrl(7)).toBe('https://ddragon.leagueoflegends.com/cdn/16.21.1/img/profileicon/7.png');
    expect(await dd.champion(266)).toEqual({
      key: 'Aatrox',
      nameKo: '아트록스',
      imageUrl: 'https://ddragon.leagueoflegends.com/cdn/16.21.1/img/champion/Aatrox.png',
    });
    expect(await dd.champion(1)).toBeNull();
    expect(f.calls.filter((c) => c.url.includes('versions.json'))).toHaveLength(1);
    expect(f.calls.filter((c) => c.url.includes('champion.json'))).toHaveLength(1);
  });

  it('RIOT_DDRAGON_VERSION 이 있으면 versions.json 을 부르지 않는다', async () => {
    const f = fakeFetch({});
    const dd = new DataDragonHttp(testOptions({ ddragonVersion: '16.1.1' }), f, fakeClock());
    expect(await dd.profileIconUrl(1)).toContain('/cdn/16.1.1/');
    expect(f.calls).toHaveLength(0);
  });

  it('실패하면 null 이고 1분 안에는 다시 부르지 않는다', async () => {
    const clock = fakeClock();
    const f = fakeFetch({ 'api/versions.json': { status: 503 } });
    const dd = new DataDragonHttp(testOptions(), f, clock);
    expect(await dd.profileIconUrl(1)).toBeNull();
    expect(await dd.profileIconUrl(1)).toBeNull();
    expect(f.calls).toHaveLength(1);
    clock.t += 61_000;
    await dd.profileIconUrl(1);
    expect(f.calls).toHaveLength(2);
  });
});
