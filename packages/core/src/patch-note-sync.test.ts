import { describe, expect, it } from 'vitest';
import {
  firstPatchSlug,
  formatPatchLine,
  parsePatchLine,
  patchNoteUrl,
  planPatchNoteInsert,
} from './patch-note-sync';

describe('패치 줄', () => {
  it('앞 두 자리만 버전 문자열로 받는다', () => {
    expect(parsePatchLine('26.21')).toEqual({ major: 26, minor: 21 });
    expect(parsePatchLine(' 18.5 ')).toEqual({ major: 18, minor: 5 });
    expect(parsePatchLine('26.21.1')).toBeNull();
    expect(parsePatchLine('패치')).toBeNull();
    expect(formatPatchLine({ major: 18, minor: 5 })).toBe('18.5');
  });

  it('목록에서 먼저 나온 슬러그를 고른다', () => {
    const lol = 'old league-of-legends-patch-26-20-notes/ league-of-legends-patch-26-21-notes/';
    expect(firstPatchSlug(lol, 'lol')).toEqual({ major: 26, minor: 20 });
    const tft = 'href="teamfight-tactics-patch-18-5/" teamfight-tactics-patch-18-4/';
    expect(firstPatchSlug(tft, 'tft')).toEqual({ major: 18, minor: 5 });
  });

  it('핫픽스 표기와 더 긴 번호는 앞 패치로 자르지 않는다', () => {
    expect(firstPatchSlug('league-of-legends-patch-26-22-hotfix', 'lol')).toBeNull();
    expect(firstPatchSlug('teamfight-tactics-patch-18-5b/', 'tft')).toBeNull();
    expect(firstPatchSlug('teamfight-tactics-patch-18-50/', 'tft')).toEqual({ major: 18, minor: 50 });
  });
});

describe('자동 등록 계획', () => {
  const line = (major: number, minor: number) => ({ major, minor });

  it('저장된 버전이 없으면 알림 없이 현재 패치 한 건', () => {
    expect(planPatchNoteInsert(line(26, 21), [null, '시즌 패치'])).toEqual({ version: '26.21', notifyDiscord: false });
  });

  it('더 새 패치만 알림을 켠다', () => {
    expect(planPatchNoteInsert(line(26, 22), ['26.21', '26.20'])).toEqual({ version: '26.22', notifyDiscord: true });
    expect(planPatchNoteInsert(line(26, 21), ['26.21'])).toBeNull();
    expect(planPatchNoteInsert(line(26, 21), ['26.22'])).toBeNull();
    expect(planPatchNoteInsert(null, [])).toBeNull();
  });

  it('주소는 게임별 공식 형식이다', () => {
    expect(patchNoteUrl('lol', line(26, 21))).toBe(
      'https://www.leagueoflegends.com/ko-kr/news/game-updates/league-of-legends-patch-26-21-notes/',
    );
    expect(patchNoteUrl('tft', line(18, 5))).toBe(
      'https://teamfighttactics.leagueoflegends.com/ko-kr/news/game-updates/teamfight-tactics-patch-18-5/',
    );
  });
});
