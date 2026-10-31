import type { DashboardRatingPolicy } from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import { eloInfoSections } from './elo-info';

const policy: DashboardRatingPolicy = { min_games: 7, k_base: 32, k_new: 40, new_player_games: 12, loss_ratio: 0.5, full_weight_games: 10, elo_weight_max: 0.2 };
const text = (p: DashboardRatingPolicy | null) => eloInfoSections(p).map((s) => s.body).join('\n');
const START = '모든 멤버가 티어와 상관없이 1000점에서 시작해요. 새 시즌이 시작되면 모두 다시 1000점이 돼요. 지난 시즌 순위는 시즌 최종 순위와 뱃지로 남아요.';

describe('ELO 설명 문구', () => {
  it('제목 5개, 숫자는 서버 값', () => {
    const s = eloInfoSections(policy);
    expect(s.map((x) => x.heading)).toEqual(['무슨 점수인가요', '언제 바뀌나요', '시작 점수는 어떻게 정하나요', '승패 점수는 왜 다른가요', '팀을 나눌 때는요']);
    const t = text(policy);
    expect(t).toContain('7경기 이상 치르면 랭킹에 나와요.');
    expect(t).toContain('한 경기 기본 폭은 32점이고, 그 게임 내전이 12경기 미만이면 40점이라');
  });
  it('무슨 점수: 티어와 상관없이 같은 점수에서 시작', () => {
    expect(eloInfoSections(policy)[0]!.body).toBe(
      '우리 서버 내전 결과로만 정해지는 점수예요. 라이엇 티어와 상관없이 모두 같은 점수에서 시작하고, 게임과 시즌마다 따로 쌓여요.',
    );
  });
  it('시작 점수: 상수 문구, 값 유무와 같다', () => {
    expect(eloInfoSections(policy)[2]!.body).toBe(START);
    expect(eloInfoSections(null)[2]!.body).toBe(START);
  });
  it('소프트 리셋·티어 시드 문구가 없다', () => {
    for (const p of [policy, null]) {
      const t = text(p);
      expect(t).not.toContain('리셋');
      expect(t).not.toContain('시드');
      expect(t).not.toContain('당겨');
      expect(t).not.toContain('아이언');
    }
  });
  it('값이 다르면 문구도 달라진다(하드코딩 아님)', () => {
    expect(text({ ...policy, k_base: 20, k_new: 24, new_player_games: 3, min_games: 2 })).toContain('한 경기 기본 폭은 20점이고, 그 게임 내전이 3경기 미만이면 24점이라');
    expect(text({ ...policy, k_base: 20 })).toContain('이길 때 +10점, 질 때 −5점');
  });
  it('팀을 나눌 때: elo_weight_max 0.2·0.35·0, full_weight_games는 서버 값', () => {
    expect(eloInfoSections(policy)[4]!.body).toBe(
      '팀 자동 밸런스는 티어를 중심으로 나누고, 내전 ELO는 이번 시즌 경기 수에 따라 조금씩 섞어요. 이번 시즌 10경기부터 최대 20%이고, 티어 비중은 80% 아래로 내려가지 않아요.',
    );
    expect(eloInfoSections({ ...policy, elo_weight_max: 0.35, full_weight_games: 6 })[4]!.body).toContain('이번 시즌 6경기부터 최대 35%이고, 티어 비중은 65% 아래로');
    expect(eloInfoSections({ ...policy, elo_weight_max: 0 })[4]!.body).toBe('팀 자동 밸런스는 티어만으로 나눠요.');
  });
  it('패배 배율 0.5·1·0', () => {
    expect(text(policy)).toContain('지면 원래 잃을 점수의 50%만 잃어요. 비슷한 상대라면 이길 때 +16점, 질 때 −8점이에요.');
    expect(text({ ...policy, loss_ratio: 1 })).toContain('이길 때와 질 때 같은 크기로 계산해요.');
    expect(text({ ...policy, loss_ratio: 0 })).toContain('져도 점수가 내려가지 않아요.');
  });
  it('ratio 0: 내려간다는 문장이 없다', () => {
    const t = text({ ...policy, loss_ratio: 0 });
    expect(t).not.toContain('약한 상대에게 질수록');
    expect(t).not.toContain('많이 내려가요');
    expect(t).toContain('한 경기 기본 폭은 32점');
    expect(eloInfoSections({ ...policy, loss_ratio: 0 })[3]!.heading).toBe('승패 점수는 왜 다른가요');
  });
  it('ratio 1: 제목은 「승패 점수」, 그 외 값은 기존 제목', () => {
    expect(eloInfoSections({ ...policy, loss_ratio: 1 })[3]!.heading).toBe('승패 점수');
    expect(eloInfoSections(policy)[3]!.heading).toBe('승패 점수는 왜 다른가요');
    expect(eloInfoSections(null)[3]!.heading).toBe('승패 점수는 왜 다른가요');
  });
  it('값이 없으면 서버 값·기본값 숫자를 보여 주지 않는다(시작 점수 상수만)', () => {
    const t = text(null);
    expect(t).toContain('일정 경기 수를 채우면 랭킹에 나와요.');
    expect(t).toContain('강한 상대를 이길수록 많이 오르고, 약한 상대에게 질수록 많이 내려가요.');
    expect(t).toContain('팀 자동 밸런스는 티어를 중심으로 나누고, 내전 ELO는 조금만 섞어요.');
    expect(t.replaceAll('1000점', '')).not.toMatch(/\d/);
    expect(eloInfoSections(null)).toHaveLength(5);
  });
});
