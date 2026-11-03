import { BOT_MEMBER_EVENTS_BATCH_MAX, BotMemberEvent, type BotMemberEvent as MemberEvent } from '@gcd/shared';
import { ApiRequestError } from './api-client';
import type { Logger } from './log';

const FLUSH_AFTER_MS = 1_000;
const RETRY_MAX_MS = 60_000;
/** API가 오래 죽어 있어도 메모리를 다 쓰지 않게 한다. 넘치면 가장 오래된 이벤트부터 버린다. */
export const MEMBER_QUEUE_MAX = 1_000;

export function createMemberBuffer(send: (events: MemberEvent[]) => Promise<void>, logger: Logger) {
  const queue: MemberEvent[] = [];
  let timer: NodeJS.Timeout | null = null;
  let sending = false;
  let failures = 0;

  function clearTimer(): void {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  }

  /** 연속 실패면 1초, 2초, 4초… 최대 60초 뒤에 다시 보낸다. */
  function delayMs(): number {
    if (failures === 0) return FLUSH_AFTER_MS;
    return Math.min(FLUSH_AFTER_MS * 2 ** failures, RETRY_MAX_MS);
  }

  function schedule(): void {
    if (failures === 0 && queue.length >= BOT_MEMBER_EVENTS_BATCH_MAX) {
      void flush();
      return;
    }
    if (!timer) timer = setTimeout(() => void flush(), delayMs());
  }

  function trim(): void {
    const over = queue.length - MEMBER_QUEUE_MAX;
    if (over <= 0) return;
    queue.splice(0, over);
    logger.error('member events dropped', { count: over });
  }

  async function flush(): Promise<void> {
    clearTimer();
    if (sending || queue.length === 0) return;
    sending = true;
    const batch = queue.splice(0, BOT_MEMBER_EVENTS_BATCH_MAX);
    try {
      await send(batch);
      failures = 0;
    } catch (err) {
      const permanent = err instanceof ApiRequestError && !err.retryable;
      if (!permanent) {
        queue.unshift(...batch);
        trim();
        failures += 1;
      }
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
      trim();
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
