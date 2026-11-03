import { describe, expect, it } from 'vitest';
import { planRanking, planUpcoming } from './plan';

const base = { type: 'tier', game: 'lol', period: null, limit: null, appId: null };

describe('슬래시 명령 옵션', () => {
  it('티어는 롤·롤체만 받는다', () => {
    expect(planRanking(base)).toEqual({ ok: true, type: 'tier', query: { game: 'lol' } });
    expect(planRanking({ ...base, game: 'steam' }).ok).toBe(false);
  });

  it('플레이타임은 앱 ID가 있어야 한다', () => {
    expect(planRanking({ ...base, type: 'playtime', game: null, appId: 578080 })).toEqual({
      ok: true,
      type: 'playtime',
      query: { app_id: 578080 },
    });
    expect(planRanking({ ...base, type: 'playtime', game: null, appId: null }).ok).toBe(false);
  });

  it('내전 범위 기본값은 60분이다', () => {
    expect(planUpcoming(null)).toEqual({ ok: true, withinMin: 60 });
    expect(planUpcoming(1441).ok).toBe(false);
  });
});
