import { BOT_ACTIVITY_BATCH_MAX, type PostBotActivityRequest, type PostBotActivityResponse } from '@gcd/shared';
import { ApiRequestError } from './api-client';
import type { Logger } from './log';
import type { OutboundEmbed } from './messages';
import { formatNotice, formatPatchNote, formatScrimDm } from './messages';
import { PATCH_DM_SCHEDULED_AT, type BotStore } from './session-store';
import { toVoiceActivityEvents, type VoiceRecoveryPlan, type VoiceSession } from './voice-session';

export class DmError extends Error {
  readonly permanent: boolean;
  constructor(permanent: boolean) {
    super(permanent ? 'dm permanent' : 'dm transient');
    this.name = 'DmError';
    this.permanent = permanent;
  }
}

type ActivityPoster = {
  postActivity(body: PostBotActivityRequest): Promise<PostBotActivityResponse>;
};

type VoiceRecoveryStore = Pick<BotStore, 'touch' | 'close' | 'insertOpen'>;
type ActivityStore = Pick<BotStore, 'listPending' | 'markDelivered'>;
type OutboundStore = Pick<BotStore, 'hasOutbound' | 'markOutbound'>;
type DirectStore = Pick<BotStore, 'wasDirectMessage' | 'markDirectMessage'>;

function logCode(err: unknown): string | null {
  if (err instanceof ApiRequestError) return err.code;
  if (err instanceof DmError) return err.permanent ? 'DM_FORBIDDEN' : 'DM_FAILED';
  return null;
}

export async function applyVoiceRecovery(
  store: VoiceRecoveryStore,
  guildId: string,
  plan: VoiceRecoveryPlan,
): Promise<void> {
  for (const keep of plan.keep) {
    await store.touch(keep.id, { channelId: keep.channelId, lastSeenAt: keep.lastSeenAt });
  }
  for (const closed of plan.close) await store.close(closed.id, closed.closedAt);
  for (const opened of plan.open) {
    await store.insertOpen({
      guildId,
      discordId: opened.discordId,
      channelId: opened.channelId,
      startedAt: opened.at,
      game: null,
    });
  }
}

/**
 * 닫혔지만 아직 API에 안 보낸 세션을 전송한다.
 * 5xx·네트워크는 같은 키로 다시 보낸다(duplicate는 성공). 400·401·403은 다시 보내지 않는다.
 * 1초 미만이라 이벤트가 없으면 보낸 것으로 표시만 한다.
 */
export async function flushActivities(
  store: ActivityStore,
  api: ActivityPoster,
  guildId: string,
  logger: Logger,
): Promise<void> {
  const pending = await store.listPending(guildId, 50);
  for (const session of pending) await flushOne(store, api, session, logger);
}

async function flushOne(store: ActivityStore, api: ActivityPoster, session: VoiceSession, logger: Logger): Promise<void> {
  if (!session.closedAt) return;
  let events;
  try {
    events = toVoiceActivityEvents(session, session.closedAt);
  } catch {
    logger.error('voice build failed', { sessionId: session.id });
    return;
  }
  if (events.length === 0) {
    await store.markDelivered(session.id);
    return;
  }
  let failed = false;
  let permanent = false;
  for (let index = 0; index < events.length; index += BOT_ACTIVITY_BATCH_MAX) {
    const part = events.slice(index, index + BOT_ACTIVITY_BATCH_MAX);
    try {
      const res = await api.postActivity({ events: part });
      logger.info('activity sent', {
        created: res.counts.created,
        duplicate: res.counts.duplicate,
        unlinked: res.counts.unlinked,
        rejected: res.counts.rejected,
      });
    } catch (err) {
      failed = true;
      permanent = err instanceof ApiRequestError && !err.retryable;
      logger.error('activity failed', {
        status: err instanceof ApiRequestError ? err.status : 0,
        code: logCode(err),
      });
      break;
    }
  }
  if (!failed || permanent) await store.markDelivered(session.id);
}

export async function deliverNotices(args: {
  store: OutboundStore;
  pending: () => Promise<{ items: Parameters<typeof formatNotice>[0][] }>;
  deliver: (id: string) => Promise<{ status: string }>;
  post: (embed: OutboundEmbed) => Promise<void>;
  logger: Logger;
}): Promise<void> {
  const page = await args.pending();
  for (const notice of page.items) {
    try {
      if (!(await args.store.hasOutbound('notice', notice.id))) {
        await args.post(formatNotice(notice));
        await args.store.markOutbound('notice', notice.id);
      }
      const res = await args.deliver(notice.id);
      args.logger.info('notice delivered', { id: notice.id, status: res.status });
    } catch (err) {
      args.logger.error('notice failed', { id: notice.id, code: logCode(err) });
    }
  }
}

export async function deliverPatchNotes(args: {
  store: OutboundStore & DirectStore;
  pending: () => Promise<{ items: Parameters<typeof formatPatchNote>[0][] }>;
  deliver: (id: string) => Promise<{ status: string }>;
  send: (discordId: string, embed: OutboundEmbed) => Promise<void>;
  logger: Logger;
}): Promise<void> {
  const page = await args.pending();
  for (const note of page.items) {
    try {
      if (!(await args.store.hasOutbound('patch', note.id))) {
        let blocked = false;
        for (const discordId of note.notify_discord_ids) {
          if (await args.store.wasDirectMessage('patch', note.id, PATCH_DM_SCHEDULED_AT, discordId)) continue;
          try {
            await args.send(discordId, formatPatchNote(note));
            await args.store.markDirectMessage('patch', note.id, PATCH_DM_SCHEDULED_AT, discordId);
          } catch (err) {
            if (err instanceof DmError && err.permanent) {
              await args.store.markDirectMessage('patch', note.id, PATCH_DM_SCHEDULED_AT, discordId);
              args.logger.info('dm skipped', { kind: 'patch' });
              continue;
            }
            args.logger.error('dm failed', { kind: 'patch', code: logCode(err) });
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
        await args.store.markOutbound('patch', note.id);
      }
      const res = await args.deliver(note.id);
      args.logger.info('patch delivered', { id: note.id, status: res.status });
    } catch (err) {
      args.logger.error('patch failed', { id: note.id, code: logCode(err) });
    }
  }
}

/** 시작 30분 전 알림. 이미 보낸 (내전, 시작 시각, 회원)은 다시 보내지 않는다. */
export async function notifyUpcomingScrims(args: {
  store: DirectStore;
  withinMin: number;
  load: (withinMin: number) => Promise<{ items: Parameters<typeof formatScrimDm>[0][] }>;
  send: (discordId: string, embed: OutboundEmbed) => Promise<void>;
  logger: Logger;
}): Promise<void> {
  const page = await args.load(args.withinMin);
  for (const scrim of page.items) {
    const scheduledAt = new Date(scrim.scheduled_at);
    if (Number.isNaN(scheduledAt.getTime())) {
      args.logger.error('scrim time invalid', { id: scrim.id });
      continue;
    }
    for (const discordId of scrim.notify_discord_ids) {
      if (await args.store.wasDirectMessage('scrim', scrim.id, scheduledAt, discordId)) continue;
      try {
        await args.send(discordId, formatScrimDm(scrim));
        await args.store.markDirectMessage('scrim', scrim.id, scheduledAt, discordId);
      } catch (err) {
        if (err instanceof DmError && err.permanent) {
          await args.store.markDirectMessage('scrim', scrim.id, scheduledAt, discordId);
          args.logger.info('dm skipped', { kind: 'scrim' });
          continue;
        }
        args.logger.error('dm failed', { kind: 'scrim', code: logCode(err) });
      }
    }
  }
}
