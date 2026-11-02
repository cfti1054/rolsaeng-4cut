import type { PutBotPresenceRequest } from '@gcd/shared';
import { ActivityType, ChannelType, type Guild } from 'discord.js';
import { buildPresenceBody } from '../presence';
import type { LiveVoiceMember } from '../voice-session';

function isBot(bot: boolean | undefined, userId: string, botId: string | null): boolean {
  if (botId && userId === botId) return true;
  return bot === true;
}

/** 지금 음성 채널에 있는 사람. 봇은 빼 둔다. */
export function liveMembers(guild: Guild, botId: string | null): LiveVoiceMember[] {
  const byId = new Map<string, string>();
  for (const state of guild.voiceStates.cache.values()) {
    if (!state.channelId) continue;
    if (state.channel && state.channel.type !== ChannelType.GuildVoice && state.channel.type !== ChannelType.GuildStageVoice) {
      continue;
    }
    if (isBot(state.member?.user.bot, state.id, botId)) continue;
    byId.set(state.id, state.channelId);
  }
  return [...byId.entries()].map(([discordId, channelId]) => ({ discordId, channelId }));
}

/** 음성 인원과, 음성 여부와 상관없이 지금 플레이 중인 게임을 한 스냅샷으로 만든다. */
export function collectSnapshot(guild: Guild, botId: string | null, capturedAt: Date): PutBotPresenceRequest {
  const voice = liveMembers(guild, botId).map(() => ({ bot: false }));
  const playing = [];
  for (const presence of guild.presences.cache.values()) {
    const activity = presence.activities.find((item) => item.type === ActivityType.Playing && item.name.trim().length > 0);
    if (!activity) continue;
    playing.push({ bot: isBot(presence.user?.bot, presence.userId, botId), name: activity.name });
  }
  return buildPresenceBody({ voice, playing, capturedAt });
}
