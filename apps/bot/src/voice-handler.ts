import type { GameCode } from '@gcd/shared';
import type { BotStore } from './session-store';
import type { VoiceSession } from './voice-session';

export type VoiceChange = {
  guildId: string;
  discordId: string;
  bot: boolean;
  beforeChannelId: string | null;
  afterChannelId: string | null;
  at: Date;
};

type VoiceBook = Pick<BotStore, 'findOpen' | 'touch' | 'insertOpen' | 'close'>;

/** 입장·이동·퇴장. 음소거처럼 채널이 그대로면 아무것도 하지 않는다. 퇴장하면 flush로 활동을 보낸다. */
export async function handleVoiceState(
  store: VoiceBook,
  expectedGuildId: string,
  change: VoiceChange,
  flush: () => Promise<void>,
): Promise<void> {
  if (change.bot || change.guildId !== expectedGuildId) return;
  if (change.beforeChannelId === change.afterChannelId) return;
  if (change.afterChannelId) {
    const existing = await store.findOpen(expectedGuildId, change.discordId);
    if (existing) {
      await store.touch(existing.id, { channelId: change.afterChannelId, lastSeenAt: change.at });
      return;
    }
    await store.insertOpen({
      guildId: expectedGuildId,
      discordId: change.discordId,
      channelId: change.afterChannelId,
      startedAt: change.at,
      game: null,
    });
    return;
  }
  const existing = await store.findOpen(expectedGuildId, change.discordId);
  if (!existing) return;
  await store.close(existing.id, change.at);
  await flush();
}

/** 세션 중에 알아낸 게임만 남긴다. 게임을 끄면 마지막 게임을 유지한다. */
export async function notePlayingGame(
  store: Pick<BotStore, 'findOpen' | 'setGame'>,
  guildId: string,
  discordId: string,
  bot: boolean,
  game: GameCode | null,
): Promise<void> {
  if (bot || !game) return;
  const open = await store.findOpen(guildId, discordId);
  if (!open || open.game === game) return;
  await store.setGame(open.id, game);
}

export type { VoiceSession };
