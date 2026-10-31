import type { ProfileBadge } from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import {
  badgeView,
  eloBarPercent,
  joinedPercent,
  mobileSeasonText,
  ratingEmptyText,
  othersJoinedText,
  recentResultOutcome,
  recentResultStatus,
  scrimCapacityText,
  seasonDayText,
  seasonFilledPips,
  secondsUntil,
  softResetText,
  topRankersTitle,
  userEloText,
} from './dashboard';

const SEASON = { id: '11111111-1111-4111-8111-111111111111', name: '시즌 2', starts_at: '2026-09-01T00:00:00.000Z', ends_at: '2026-12-01T00:00:00.000Z' };

describe('시즌 카드', () => {
  it('D-day', () => {
    expect(seasonDayText(34)).toBe('D-34');
    expect(seasonDayText(0)).toBe('D-DAY');
  });
  it('12칸 반올림', () => {
    expect(seasonFilledPips(0)).toBe(0);
    expect(seasonFilledPips(0.66)).toBe(8);
    expect(seasonFilledPips(1)).toBe(12);
  });
  it('소프트 리셋 문구는 비율로 정한다', () => {
    expect(softResetText(1 / 2)).toBe('종료 시 레이팅 절반 소프트 리셋');
    expect(softResetText(0.3)).toBe('종료 시 1000 기준 차이의 30%만 유지');
    expect(softResetText(1)).toBe('종료 시 레이팅 유지');
    expect(softResetText(0)).toBe('종료 시 레이팅 1000으로 초기화');
  });
  it('소프트 리셋 경계: 별도 문구는 정확히 0·0.5·1일 때만, N은 반올림', () => {
    expect(softResetText(0.51)).toBe('종료 시 1000 기준 차이의 51%만 유지');
    expect(softResetText(0.49)).toBe('종료 시 1000 기준 차이의 49%만 유지');
    expect(softResetText(0.999)).toBe('종료 시 1000 기준 차이의 100%만 유지');
    expect(softResetText(0.001)).toBe('종료 시 1000 기준 차이의 0%만 유지');
    expect(softResetText(0.125)).toBe('종료 시 1000 기준 차이의 13%만 유지');
  });
  it('모바일 머리', () => {
    expect(mobileSeasonText({ name: '시즌 2', days_left: 34 })).toBe('시즌 2 · D-34');
    expect(mobileSeasonText({ name: '시즌 2', days_left: 0 })).toBe('시즌 2 · D-DAY');
    expect(mobileSeasonText(null)).toBe('다음 시즌 준비 중');
  });
  it('프로필 레이팅 빈 문구: 시즌 공백이면 기록 없음이라 하지 않는다', () => {
    expect(ratingEmptyText({ season: null })).toEqual({ value: '다음 시즌 준비 중', sub: '현재 진행 중인 시즌이 없어요' });
    expect(ratingEmptyText({ season: { name: '시즌 2' } })).toEqual({ value: '내전 기록 없음', sub: '시즌 2' });
    expect(ratingEmptyText(null).value).toBe('내전 기록 없음');
  });
  it('사용자 카드', () => {
    expect(userEloText({ elo: 1421, rank: 3 })).toBe('ELO 1421 · #3');
    expect(userEloText({ elo: 1421, rank: null })).toBe('ELO 1421');
    expect(userEloText(null)).toBeNull();
  });
});

describe('다음 내전', () => {
  it('정원 표기는 has_teams로 정한다', () => {
    expect(scrimCapacityText('롤 협곡', { capacity: 10, game: { has_teams: true } })).toBe('롤 협곡 · 5 vs 5');
    expect(scrimCapacityText('롤체', { capacity: 8, game: { has_teams: false } })).toBe('롤체 · 8인');
    expect(scrimCapacityText('스팀', { capacity: 7, game: { has_teams: true } })).toBe('스팀 · 7인');
  });
  it('외 N명: 아바타로 다 보이면 없음', () => {
    expect(othersJoinedText(8, 6)).toBe('외 2명 참가 중');
    expect(othersJoinedText(6, 6)).toBeNull();
  });
  it('카운트다운: 지났으면 null', () => {
    const at = '2026-10-30T12:00:00.000Z';
    expect(secondsUntil(at, Date.parse(at) - 90_500)).toBe(90);
    expect(secondsUntil(at, Date.parse(at))).toBeNull();
    expect(secondsUntil(at, null)).toBeNull();
  });
  it('인원 막대', () => {
    expect(joinedPercent({ joined_count: 5, capacity: 8 })).toBe(63);
    expect(joinedPercent({ joined_count: 12, capacity: 10 })).toBe(100);
  });
});

describe('TOP 랭커', () => {
  it('제목: 최종이면 시즌 이름, 모바일은 3명', () => {
    expect(topRankersTitle({ is_final: false, season: SEASON })).toBe('시즌 ELO TOP 5');
    expect(topRankersTitle({ is_final: false, season: SEASON }, 3)).toBe('시즌 ELO TOP 3');
    expect(topRankersTitle({ is_final: true, season: SEASON })).toBe('시즌 2 최종 ELO TOP 5');
    expect(topRankersTitle(null)).toBe('시즌 ELO TOP 5');
  });
  it('막대 폭 = elo ÷ 1위 elo', () => {
    expect(eloBarPercent(1512, 1512)).toBe(100);
    expect(eloBarPercent(1421, 1512)).toBe(94);
    expect(eloBarPercent(100, 0)).toBe(0);
  });
});

describe('최근 내전 결과', () => {
  it('상태 알약 5경우', () => {
    expect(recentResultStatus({ result_status: 'pending', rating_status: 'waiting', elo_swing: null })).toEqual({ text: '승인 대기', tone: 'pending' });
    expect(recentResultStatus({ result_status: 'pending', rating_status: 'not_rated', elo_swing: null }).text).toBe('승인 대기');
    expect(recentResultStatus({ result_status: 'approved', rating_status: 'applied', elo_swing: 16 })).toEqual({ text: '최대 16점 변동', tone: 'applied' });
    expect(recentResultStatus({ result_status: 'approved', rating_status: 'applied', elo_swing: null }).text).toBe('반영 완료');
    expect(recentResultStatus({ result_status: 'approved', rating_status: 'skipped', elo_swing: null }).text).toBe('미반영');
    expect(recentResultStatus({ result_status: 'approved', rating_status: 'not_rated', elo_swing: null }).text).toBe('미반영');
  });
  it('결과 막대: 팀·개인', () => {
    expect(recentResultOutcome({ outcome: { winner_team: 'blue', winner: null } })).toEqual({ kind: 'team', blue: 'BLUE WIN', orange: 'RED', winner: 'blue' });
    expect(recentResultOutcome({ outcome: { winner_team: 'orange', winner: null } })).toMatchObject({ blue: 'BLUE', orange: 'RED WIN' });
    expect(recentResultOutcome({ outcome: { winner_team: null, winner: { id: SEASON.id, nickname: '체스왕', avatar_url: null } } })).toEqual({ kind: 'solo', left: '1위', right: '체스왕' });
  });
});

describe('뱃지', () => {
  const b: ProfileBadge = {
    id: SEASON.id,
    code: 'season_lol_top1',
    name: '리그 오브 레전드 시즌 1위',
    description: null,
    earned_at: '2026-08-31T15:00:00.000Z',
    season: SEASON,
    game: 'lol',
    place: 1,
  };
  it('시즌 뱃지', () => {
    expect(badgeView(b)).toEqual({ mark: '#1', place: 1, title: '시즌 2 · 리그 오브 레전드 시즌 1위', when: '2026.08' });
  });
  it('월 표시는 끝나는 달: 배타적 경계 바로 뒤 시각만 다음 달', () => {
    expect(badgeView({ ...b, earned_at: '2026-08-31T15:00:00.000Z' }).when).toBe('2026.08');
    expect(badgeView({ ...b, earned_at: '2026-08-31T15:00:00.001Z' }).when).toBe('2026.09');
  });
  it('시즌 뱃지가 아니면 코드 없이 이름만', () => {
    expect(badgeView({ ...b, code: 'first_scrim', name: '첫 내전', season: null, game: null, place: null })).toEqual({ mark: null, place: null, title: '첫 내전', when: '2026.08' });
  });
});
