import { BOT_PRESENCE_PLAYING_MAX, PutBotPresenceRequest, type GameCode, type PutBotPresenceRequest as PutBotPresenceBody } from '@gcd/shared';
import { mapActivityName } from './game-map';
import { formatIsoWithKstOffset } from './time';

export type PlayingMember = {
  name: string;
  game: GameCode | null;
  steamAppId: number | null;
};

/** 같은 이름·게임·앱은 인원을 합치고, 많은 순으로 최대 20개. */
export function aggregatePlaying(members: readonly PlayingMember[]): PutBotPresenceBody['playing'] {
  const grouped = new Map<string, PutBotPresenceBody['playing'][number]>();
  for (const member of members) {
    const name = member.name.trim().slice(0, 100);
    if (!name) continue;
    const key = `${name}\u0000${member.game ?? ''}\u0000${member.steamAppId ?? ''}`;
    const row = grouped.get(key);
    if (row) row.count += 1;
    else grouped.set(key, { name, game: member.game, steam_app_id: member.steamAppId, count: 1 });
  }
  return [...grouped.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'))
    .slice(0, BOT_PRESENCE_PLAYING_MAX);
}

export function buildPresenceBody(input: {
  voice: readonly { bot: boolean }[];
  playing: readonly { bot: boolean; name: string }[];
  capturedAt: Date;
}): PutBotPresenceBody {
  const playing = input.playing
    .filter((member) => !member.bot)
    .map((member) => {
      const mapped = mapActivityName(member.name);
      return { name: member.name, game: mapped.game, steamAppId: mapped.steamAppId };
    });
  return PutBotPresenceRequest.parse({
    captured_at: formatIsoWithKstOffset(input.capturedAt),
    voice_member_count: input.voice.filter((member) => !member.bot).length,
    playing: aggregatePlaying(playing),
  });
}
