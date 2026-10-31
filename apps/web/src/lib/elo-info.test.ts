import type { DashboardRatingPolicy } from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import { eloInfoSections } from './elo-info';

const policy: DashboardRatingPolicy = { soft_reset_ratio: 0.5, min_games: 7, k_base: 32, k_new: 40, new_player_games: 12, loss_ratio: 0.5 };
const text = (p: DashboardRatingPolicy | null) => eloInfoSections(p).map((s) => s.body).join('\n');

describe('ELO 설명 문구', () => {
  it('제목 4개, 숫자는 서버 값', () => {
    const s = eloInfoSections(policy);
    expect(s.map((x) => x.heading)).toEqual(['무슨 점수인가요', '언제 바뀌나요', '시작 점수는 어떻게 정하나요', '승패 점수는 왜 다른가요']);
    const t = text(policy);
    expect(t).toContain('7경기 이상 치르면 랭킹에 나와요.');
    expect(t).toContain('한 경기 기본 폭은 32점이고, 그 게임 내전이 12경기 미만이면 40점이라');
  });
  it('시드 범위는 core 상수', () => {
    expect(text(policy)).toContain('아이언 600점부터 마스터 이상 2000점까지이고, 티어가 없으면 1000점이에요.');
  });
  it('값이 다르면 문구도 달라진다(하드코딩 아님)', () => {
    expect(text({ ...policy, k_base: 20, k_new: 24, new_player_games: 3, min_games: 2 })).toContain('한 경기 기본 폭은 20점이고, 그 게임 내전이 3경기 미만이면 24점이라');
    expect(text({ ...policy, k_base: 20 })).toContain('이길 때 +10점, 질 때 −5점');
  });
  it('소프트 리셋 ratio 0.5·0.3·1·0', () => {
    expect(text(policy)).toContain('1000점과의 차이를 50%만 남겨요. 예를 들어 1400점이면 1200점에서 시작해요.');
    expect(text({ ...policy, soft_reset_ratio: 0.3 })).toContain('차이를 30%만 남겨요. 예를 들어 1400점이면 1120점에서 시작해요.');
    expect(text({ ...policy, soft_reset_ratio: 1 })).toContain('지난 시즌 기록이 있으면 지난 시즌 점수를 그대로 이어 가요. 기록이 없으면');
    expect(text({ ...policy, soft_reset_ratio: 0 })).toContain('지난 시즌 기록이 있으면 모두 1000점에서 다시 시작해요. 기록이 없으면');
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
  it('값이 없으면 서버 값·기본값 숫자를 보여 주지 않는다', () => {
    const t = text(null);
    expect(t).toContain('일정 경기 수를 채우면 랭킹에 나와요.');
    expect(t).toContain('1000점 쪽으로 점수를 당겨 시작해요.');
    expect(t).toContain('강한 상대를 이길수록 많이 오르고, 약한 상대에게 질수록 많이 내려가요.');
    expect(t.replace('1000점', '')).not.toMatch(/\d/);
    expect(eloInfoSections(null)).toHaveLength(4);
  });
});
