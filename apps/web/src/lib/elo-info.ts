import { RATING_SEED_BY_TIER, RATING_SEED_DEFAULT, SEASON_SOFT_RESET_CENTER, previewTeamElo, softResetElo } from '@gcd/core';
import type { DashboardRatingPolicy } from '@gcd/shared';

/**
 * ⓘ 「내전 ELO란?」 문구(계약 19-3, D176·D178). 숫자는 서버 rating_policy와 core 상수·계산만 쓴다.
 * 값이 없으면(로딩·요약 실패) 기본값을 대신 보여 주지 않고 숫자 없는 문구를 쓴다.
 */

export const ELO_INFO_TITLE = '내전 ELO란?';
export const ELO_INFO_LABEL = '내전 ELO 설명';

/** 소프트 리셋 설명에 드는 예시 점수 */
const RESET_EXAMPLE_ELO = 1400;

const percent = (ratio: number) => Math.round(ratio * 100);

function softResetSentence(ratio: number): string {
  if (ratio === 1) return '지난 시즌 점수를 그대로 이어 가요.';
  if (ratio === 0) return `모두 ${SEASON_SOFT_RESET_CENTER}점에서 다시 시작해요.`;
  return `${SEASON_SOFT_RESET_CENTER}점과의 차이를 ${percent(ratio)}%만 남겨요. 예를 들어 ${RESET_EXAMPLE_ELO}점이면 ${softResetElo(RESET_EXAMPLE_ELO, ratio)}점에서 시작해요. 지난 시즌 실력은 살리면서 새 시즌에 서로 따라잡을 기회를 주려는 규칙이에요.`;
}

function asymmetrySentence(policy: DashboardRatingPolicy): string {
  const ratio = policy.loss_ratio;
  if (ratio === 1) return '이길 때와 질 때 같은 크기로 계산해요.';
  if (ratio === 0) return '져도 점수가 내려가지 않아요.';
  const { win, lose } = previewTeamElo({ blueAvg: RATING_SEED_DEFAULT, orangeAvg: RATING_SEED_DEFAULT, k: policy.k_base, lossRatio: ratio }).blue;
  return `지면 원래 잃을 점수의 ${percent(ratio)}%만 잃어요. 비슷한 상대라면 이길 때 +${win}점, 질 때 −${Math.abs(lose)}점이에요. 지는 부담을 줄여 내전에 편하게 참여하도록 한 규칙이에요.`;
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
    body: '우리 서버 내전 결과로만 정해지는 실력 점수예요. 라이엇 티어와는 따로 계산하고, 게임과 시즌마다 따로 쌓여요.',
  };
  const whenBase = '운영진이 내전 결과를 승인할 때만 바뀌어요. 실제로 뛴 멤버만 바뀌고, 노쇼나 팀에 들지 않은 멤버는 그대로예요.';
  if (!policy) {
    return [
      what,
      { heading: '언제 바뀌나요', body: `${whenBase} 일정 경기 수를 채우면 랭킹에 나와요.` },
      {
        heading: '시작 점수는 어떻게 정하나요',
        body: `지난 시즌 기록이 있으면 ${SEASON_SOFT_RESET_CENTER}점 쪽으로 점수를 당겨 시작해요. 새 시즌에 서로 따라잡을 기회를 주려는 규칙이에요. 기록이 없으면 연동한 티어로 정해서 처음부터 실력에 가까운 자리에서 시작해요.`,
      },
      { heading: '승패 점수는 왜 다른가요', body: '강한 상대를 이길수록 많이 오르고, 약한 상대에게 질수록 많이 내려가요.' },
    ];
  }
  return [
    what,
    { heading: '언제 바뀌나요', body: `${whenBase} ${policy.min_games}경기 이상 치르면 랭킹에 나와요.` },
    {
      heading: '시작 점수는 어떻게 정하나요',
      body: `그 시즌 첫 경기가 반영될 때 정해져요. 지난 시즌 기록이 있으면 ${softResetSentence(policy.soft_reset_ratio)} 기록이 없으면 연동한 티어로 정해요. 아이언 ${RATING_SEED_BY_TIER.IRON}점부터 마스터 이상 ${RATING_SEED_BY_TIER.MASTER}점까지이고, 티어가 없으면 ${RATING_SEED_DEFAULT}점이에요. 처음부터 실력에 가까운 자리에서 시작하도록 한 규칙이에요.`,
    },
    {
      // 같은 크기일 때는 「왜 다른가요」가 본문과 어긋난다(D181)
      heading: policy.loss_ratio === 1 ? '승패 점수' : '승패 점수는 왜 다른가요',
      body: `${asymmetrySentence(policy)} ${strengthSentence(policy.loss_ratio)} 한 경기 기본 폭은 ${policy.k_base}점이고, 그 게임 내전이 ${policy.new_player_games}경기 미만이면 ${policy.k_new}점이라 더 빨리 움직여요.`,
    },
  ];
}
