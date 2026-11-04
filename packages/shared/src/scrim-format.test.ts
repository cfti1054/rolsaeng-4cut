import { describe, expect, it } from 'vitest';
import { CreateScrimRequest, LolFormat, LOL_FORMAT_LABEL } from './index';
import { appliedAutoBalance, appliedRated, availableLolFormats, isFormatAllowed, isPartyRecruit, recruitFormat } from './scrims';

describe('롤 진행 방식 솔랭내기(solo)', () => {
  it('라벨과 값이 계약에 있다', () => {
    expect(LolFormat.options).toEqual(['scrim', 'party', 'solo']);
    expect(LOL_FORMAT_LABEL.solo).toBe('솔랭내기');
  });

  it('협곡 롤에서만 고를 수 있고, 칼바람·롤체에서는 막는다', () => {
    expect(isFormatAllowed('lol', 'rift', 'solo')).toBe(true);
    expect(isFormatAllowed('lol', null, 'solo')).toBe(true);
    expect(isFormatAllowed('lol', 'aram', 'solo')).toBe(false);
    expect(isFormatAllowed('tft', null, 'solo')).toBe(false);
    expect(isFormatAllowed('lol', 'aram', 'scrim')).toBe(true);
    expect(isFormatAllowed('lol', 'aram', null)).toBe(true);
  });

  it('작성 화면 목록은 맵·게임에 맞는 것만 보여 준다', () => {
    expect(availableLolFormats('lol', 'rift')).toEqual(['scrim', 'party', 'solo']);
    expect(availableLolFormats('lol', 'aram')).toEqual(['scrim', 'party']);
    expect(availableLolFormats('tft', null)).toEqual(['scrim', 'party']);
  });

  it('솔랭내기는 파티 모집이 아니므로 내전과 같이 밸런스·ELO를 쓸 수 있다', () => {
    const format = recruitFormat('lol', null, 'solo');
    expect(format).toBe('solo');
    expect(isPartyRecruit('lol', null, format)).toBe(false);
    expect(appliedAutoBalance({ game: 'lol', hasTeams: true, tftMode: null, requested: true })).toBe(true);
    expect(appliedRated(true, true)).toBe(true);
  });

  it('작성 요청 검증: 협곡 롤의 솔랭내기는 통과, 칼바람은 거부', () => {
    const base = {
      game: 'lol' as const,
      title: '협곡 솔랭내기',
      scheduled_at: '2026-11-10T21:00:00+09:00',
      capacity: 10,
      lol_format: 'solo' as const,
    };
    expect(CreateScrimRequest.safeParse({ ...base, lol_map: 'rift' }).success).toBe(true);
    expect(CreateScrimRequest.safeParse(base).success).toBe(true);
    const aram = CreateScrimRequest.safeParse({ ...base, lol_map: 'aram' });
    expect(aram.success).toBe(false);
    expect(aram.error?.issues.some((i) => i.path.join('.') === 'lol_format')).toBe(true);
  });
});
