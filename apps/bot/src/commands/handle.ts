import type { ChatInputCommandInteraction, Interaction } from 'discord.js';
import type { BotApiClient } from '../api-client';
import { ApiRequestError } from '../api-client';
import { formatRanking, formatUpcoming } from '../messages';
import { RANKING_COMMAND, SCRIM_COMMAND, planRanking, planUpcoming } from './plan';

export async function handleInteraction(
  interaction: Interaction,
  deps: { guildId: string; api: Pick<BotApiClient, 'ranking' | 'upcomingScrims'> },
): Promise<void> {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.guildId !== deps.guildId) {
    await interaction.reply({ content: '이 서버에서만 쓸 수 있습니다.', ephemeral: true });
    return;
  }
  if (interaction.commandName === RANKING_COMMAND) {
    await replyRanking(interaction, deps.api);
    return;
  }
  if (interaction.commandName === SCRIM_COMMAND) {
    await replyScrims(interaction, deps.api);
  }
}

async function replyRanking(
  interaction: ChatInputCommandInteraction,
  api: Pick<BotApiClient, 'ranking'>,
): Promise<void> {
  const plan = planRanking({
    type: interaction.options.getString('종류'),
    game: interaction.options.getString('게임'),
    period: interaction.options.getString('기간'),
    limit: interaction.options.getInteger('인원'),
    appId: interaction.options.getInteger('앱'),
  });
  if (!plan.ok) {
    await interaction.reply({ content: plan.message, ephemeral: true });
    return;
  }
  await interaction.deferReply();
  try {
    const res = await api.ranking(plan.type, plan.query);
    await interaction.editReply({ embeds: [formatRanking(res)] });
  } catch (err) {
    const text =
      err instanceof ApiRequestError && err.status === 403
        ? '랭킹을 볼 권한이 없는 API 키입니다.'
        : '랭킹을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.';
    await interaction.editReply({ content: text });
  }
}

async function replyScrims(
  interaction: ChatInputCommandInteraction,
  api: Pick<BotApiClient, 'upcomingScrims'>,
): Promise<void> {
  const plan = planUpcoming(interaction.options.getInteger('범위'));
  if (!plan.ok) {
    await interaction.reply({ content: plan.message, ephemeral: true });
    return;
  }
  await interaction.deferReply();
  try {
    const res = await api.upcomingScrims(plan.withinMin);
    await interaction.editReply({ embeds: [formatUpcoming(res, plan.withinMin)] });
  } catch (err) {
    const text =
      err instanceof ApiRequestError && err.status === 403
        ? '내전을 볼 권한이 없는 API 키입니다.'
        : '내전을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.';
    await interaction.editReply({ content: text });
  }
}
