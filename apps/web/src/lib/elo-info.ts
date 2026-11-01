import { previewTeamElo } from '@gcd/core';
import { BALANCE_ELO_WEIGHT_MAX, BALANCE_FULL_WEIGHT_GAMES, RATING_START_ELO, type DashboardRatingPolicy } from '@gcd/shared';

/**
 * ⓘ 「내전 ELO란?」 문구(계약 19-3, 20-7, D176·D178·D194). 숫자는 서버 rating_policy와 고정 상수 RATING_START_ELO·core 계산만 쓴다.
 * 값이 없으면(로딩·요약 실패) 기본값을 대신 보여 주지 않고 숫자 없는 문구를 쓴다(시작 점수는 상수라 예외).
 */

export const ELO_INFO_TITLE = '내전/모집 ELO란?';
export const ELO_INFO_LABEL = '내전/모집 ELO 설명';

/** 더블업 2인 팀 설명. 숫자는 롤 밸런스와 같은 계약 상수다. */
export function duoBalanceNote(): string {
  const n = percent(BALANCE_ELO_WEIGHT_MAX);
  return `티어를 중심으로 2명씩 나눕니다. 이번 시즌 ${BALANCE_FULL_WEIGHT_GAMES}경기부터 내전/모집 ELO를 최대 ${n}% 반영해요.`;
}

const percent = (ratio: number) => Math.round(ratio * 100);

function asymmetrySentence(policy: DashboardRatingPolicy): string {
  const ratio = policy.loss_ratio;
  if (ratio === 1) return '이길 때와 질 때 같은 크기로 계산해요.';
  if (ratio === 0) return '져도 점수가 내려가지 않아요.';
  const { win, lose } = previewTeamElo({ blueAvg: RATING_START_ELO, orangeAvg: RATING_START_ELO, k: policy.k_base, lossRatio: ratio }).blue;
  return `지면 원래 잃을 점수의 ${percent(ratio)}%만 잃어요. 비슷한 상대라면 이길 때 +${win}점, 질 때 −${Math.abs(lose)}점이에요. 지는 부담을 줄여 내전/모집에 편하게 참여하도록 한 규칙이에요.`;
}

function balanceSentence(policy: DashboardRatingPolicy): string {
  const n = percent(policy.elo_weight_max);
  if (n === 0) return '팀 자동 밸런스는 티어만으로 나눠요.';
  return `팀 자동 밸런스는 티어를 중심으로 나누고, 내전/모집 ELO는 이번 시즌 경기 수에 따라 조금씩 섞어요. 이번 시즌 ${policy.full_weight_games}경기부터 최대 ${n}%이고, 티어 비중은 ${100 - n}% 아래로 내려가지 않아요.`;
}

export interface EloInfoSection {
  heading: string;
  body: string;
}

/** 강약 문장. ratio 0이면 내려가지 않으므로 「내려가요」를 쓰지 않는다 */
function strengthSentence(lossRatio: number): string {
  return lossRatio === 0 ? '강한 상대를 이길수록 많이 올라요.' : '강한 상대를 이길수록 많이 오르고, 약한 상대에게 질수록 많이 내려가요.';
}

export function eloInfoSections(policy: DashboardRatingPolicy | null): EloInfoSection[] {
  const what = {
    heading: '무슨 점수인가요',
    body: '우리 서버 내전/모집 결과로만 정해지는 점수예요. 라이엇 티어와 상관없이 모두 같은 점수에서 시작하고, 게임과 시즌마다 따로 쌓여요.',
  };
  const whenBase = '운영진이 내전/모집 결과를 승인할 때만 바뀌어요. 실제로 뛴 멤버만 바뀌고, 노쇼나 팀에 들지 않은 멤버는 그대로예요.';
  const start = {
    heading: '시작 점수는 어떻게 정하나요',
    body: `모든 멤버가 티어와 상관없이 ${RATING_START_ELO}점에서 시작해요. 새 시즌이 시작되면 모두 다시 ${RATING_START_ELO}점이 돼요. 지난 시즌 순위는 시즌 최종 순위와 뱃지로 남아요.`,
  };
  const balanceHeading = '팀을 나눌 때는요';
  if (!policy) {
    return [
      what,
      { heading: '언제 바뀌나요', body: `${whenBase} 일정 경기 수를 채우면 랭킹에 나와요.` },
      start,
      { heading: '승패 점수는 왜 다른가요', body: '강한 상대를 이길수록 많이 오르고, 약한 상대에게 질수록 많이 내려가요.' },
      { heading: balanceHeading, body: '팀 자동 밸런스는 티어를 중심으로 나누고, 내전/모집 ELO는 조금만 섞어요.' },
    ];
  }
  return [
    what,
    { heading: '언제 바뀌나요', body: `${whenBase} ${policy.min_games}경기 이상 치르면 랭킹에 나와요.` },
    start,
    {
      // 같은 크기일 때는 「왜 다른가요」가 본문과 어긋난다(D181)
      heading: policy.loss_ratio === 1 ? '승패 점수' : '승패 점수는 왜 다른가요',
      body: `${asymmetrySentence(policy)} ${strengthSentence(policy.loss_ratio)} 한 경기 기본 폭은 ${policy.k_base}점이고, 그 게임 내전/모집이 ${policy.new_player_games}경기 미만이면 ${policy.k_new}점이라 더 빨리 움직여요.`,
    },
    { heading: balanceHeading, body: balanceSentence(policy) },
  ];
}
