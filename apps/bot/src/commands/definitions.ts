import { SlashCommandBuilder } from 'discord.js';
import { RANKING_COMMAND, SCRIM_COMMAND } from './plan';

/** 길드 명령으로 등록한다. 이름 규칙은 가이드의 /랭킹, /내전. */
export function slashCommandBody(): unknown[] {
  const ranking = new SlashCommandBuilder()
    .setName(RANKING_COMMAND)
    .setDescription('커뮤니티 랭킹을 보여 줍니다.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('종류')
        .setDescription('랭킹 종류')
        .setRequired(true)
        .addChoices(
          { name: '티어', value: 'tier' },
          { name: '내전 ELO', value: 'elo' },
          { name: '활동', value: 'activity' },
          { name: '플레이타임', value: 'playtime' },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('게임')
        .setDescription('티어·ELO에 필요')
        .addChoices(
          { name: '롤', value: 'lol' },
          { name: '롤체', value: 'tft' },
          { name: '스팀', value: 'steam' },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('기간')
        .setDescription('활동 랭킹 기간. 기본은 이번 주')
        .addChoices(
          { name: '이번 주', value: 'week' },
          { name: '이번 달', value: 'month' },
        ),
    )
    .addIntegerOption((option) => option.setName('인원').setDescription('몇 명까지 (1–25)').setMinValue(1).setMaxValue(25))
    .addIntegerOption((option) => option.setName('앱').setDescription('스팀 앱 ID (플레이타임)').setMinValue(1));

  const scrim = new SlashCommandBuilder()
    .setName(SCRIM_COMMAND)
    .setDescription('곧 시작하는 내전을 보여 줍니다.')
    .setDMPermission(false)
    .addIntegerOption((option) =>
      option.setName('범위').setDescription('몇 분 이내. 기본 60, 최대 1440').setMinValue(1).setMaxValue(1440),
    );

  return [ranking.toJSON(), scrim.toJSON()];
}
