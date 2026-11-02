import {
  BOT_ACTIVITY_MAX_DURATION_SEC,
  BotActivityEvent,
  GameCode,
  type BotActivityEvent as BotActivityEventT,
  type GameCode as GameCodeT,
} from '@gcd/shared';
import { formatIsoWithKstOffset, kstCompact, nextKstMidnight } from './time';

export type VoiceSession = {
  id: string;
  guildId: string;
  discordId: string;
  channelId: string;
  startedAt: Date;
  lastSeenAt: Date;
  game: GameCodeT | null;
  closedAt: Date | null;
};

export type LiveVoiceMember = {
  discordId: string;
  channelId: string;
};

export type VoiceRecoveryPlan = {
  /** 아직 음성 채널에 있다. 채널과 last_seen을 갱신한다. */
  keep: Array<{ id: string; channelId: string; lastSeenAt: Date }>;
  /** 채널에서 사라졌다. closedAt까지로 끊는다. */
  close: Array<{ id: string; closedAt: Date }>;
  /** 저장소에 없는데 채널에 있다. now부터 새 세션. */
  open: Array<{ discordId: string; channelId: string; at: Date }>;
};

export type VoiceSegment = {
  startedAt: Date;
  durationSec: number;
  idempotencyKey: string;
};

/**
 * 음성 세션을 KST 자정 단위로 나눈다(계약 6-2, 하루 86400초).
 * 1초 미만 조각은 뺀다. 같은 시작 초는 같은 멱등 키다.
 */
export function voiceSegments(discordId: string, startedAt: Date, endedAt: Date): VoiceSegment[] {
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
    throw new Error('voice segment: 시각이 아님');
  }
  if (endedAt.getTime() <= startedAt.getTime()) return [];
  const segments: VoiceSegment[] = [];
  let cursor = startedAt;
  for (let guard = 0; cursor < endedAt; guard += 1) {
    if (guard > 400) throw new Error('voice segment: 구간이 너무 김');
    const boundary = nextKstMidnight(cursor);
    const segEnd = boundary < endedAt ? boundary : endedAt;
    if (segEnd.getTime() <= cursor.getTime()) throw new Error('voice segment: 구간이 진행되지 않음');
    const durationSec = Math.floor((segEnd.getTime() - cursor.getTime()) / 1000);
    if (durationSec > BOT_ACTIVITY_MAX_DURATION_SEC) throw new Error('voice segment: 하루를 넘음');
    if (durationSec >= 1) {
      segments.push({
        startedAt: cursor,
        durationSec,
        idempotencyKey: `voice-${discordId}-${kstCompact(cursor)}`,
      });
    }
    cursor = segEnd;
  }
  return segments;
}

/** 닫힌 세션을 POST /bot/activity 이벤트로 만든다. 게임이 코드가 아니면 빼 둔다. */
export function toVoiceActivityEvents(session: VoiceSession, endedAt: Date): BotActivityEventT[] {
  const game = session.game && GameCode.safeParse(session.game).success ? session.game : null;
  return voiceSegments(session.discordId, session.startedAt, endedAt).map((segment) =>
    BotActivityEvent.parse({
      idempotency_key: segment.idempotencyKey,
      discord_id: session.discordId,
      type: 'voice',
      ...(game ? { game } : {}),
      started_at: formatIsoWithKstOffset(segment.startedAt),
      duration_sec: segment.durationSec,
    }),
  );
}

/**
 * 재시작 직후: 열려 있는 세션과 지금 음성 채널 인원을 맞춘다.
 * 같은 회원의 열린 세션이 둘이면 가장 늦은 시작만 남긴다.
 * 채널에 없으면 last_seen까지로 닫아, 봇이 꺼져 있던 시간을 음성 시간으로 넣지 않는다.
 */
export function planVoiceRecovery(
  open: readonly VoiceSession[],
  current: readonly LiveVoiceMember[],
  now: Date,
): VoiceRecoveryPlan {
  const channelByUser = new Map<string, string>();
  for (const member of current) channelByUser.set(member.discordId, member.channelId);

  const sessionsByUser = new Map<string, VoiceSession[]>();
  for (const session of open) {
    const list = sessionsByUser.get(session.discordId);
    if (list) list.push(session);
    else sessionsByUser.set(session.discordId, [session]);
  }

  const keep: VoiceRecoveryPlan['keep'] = [];
  const close: VoiceRecoveryPlan['close'] = [];
  for (const [discordId, sessions] of sessionsByUser) {
    const ordered = [...sessions].sort((a, b) => {
      const byStart = b.startedAt.getTime() - a.startedAt.getTime();
      if (byStart !== 0) return byStart;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const primary = ordered[0];
    if (!primary) continue;
    for (const extra of ordered.slice(1)) close.push({ id: extra.id, closedAt: extra.lastSeenAt });
    const channelId = channelByUser.get(discordId);
    if (channelId) {
      keep.push({ id: primary.id, channelId, lastSeenAt: now });
    } else {
      const closedAt =
        primary.lastSeenAt.getTime() > primary.startedAt.getTime() ? primary.lastSeenAt : primary.startedAt;
      close.push({ id: primary.id, closedAt });
    }
  }

  const openNext: VoiceRecoveryPlan['open'] = [];
  for (const [discordId, channelId] of channelByUser) {
    if (sessionsByUser.has(discordId)) continue;
    openNext.push({ discordId, channelId, at: now });
  }
  return { keep, close, open: openNext };
}
