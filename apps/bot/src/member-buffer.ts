import { BOT_MEMBER_EVENTS_BATCH_MAX, BotMemberEvent, type BotMemberEvent as MemberEvent } from '@gcd/shared';
import { ApiRequestError } from './api-client';
import type { Logger } from './log';

const FLUSH_AFTER_MS = 1_000;

export function createMemberBuffer(send: (events: MemberEvent[]) => Promise<void>, logger: Logger) {
  const queue: MemberEvent[] = [];
  let timer: NodeJS.Timeout | null = null;
  let sending = false;

  function clearTimer(): void {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  }

  function schedule(): void {
    if (queue.length >= BOT_MEMBER_EVENTS_BATCH_MAX) {
      void flush();
      return;
    }
    if (!timer) timer = setTimeout(() => void flush(), FLUSH_AFTER_MS);
  }

  async function flush(): Promise<void> {
    clearTimer();
    if (sending || queue.length === 0) return;
    sending = true;
    const batch = queue.splice(0, BOT_MEMBER_EVENTS_BATCH_MAX);
    try {
      await send(batch);
    } catch (err) {
      const permanent = err instanceof ApiRequestError && !err.retryable;
      if (!permanent) queue.unshift(...batch);
      logger.error('member events failed', {
        status: err instanceof ApiRequestError ? err.status : 0,
        code: err instanceof ApiRequestError ? err.code : null,
      });
    } finally {
      sending = false;
      if (queue.length > 0) schedule();
    }
  }

  return {
    push(event: MemberEvent) {
      const parsed = BotMemberEvent.safeParse(event);
      if (!parsed.success) {
        logger.error('member event invalid', {});
        return;
      }
      queue.push(parsed.data);
      schedule();
    },
    flush,
    pending(): number {
      return queue.length;
    },
    stop() {
      clearTimer();
    },
  };
}
