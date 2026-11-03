import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './api-client';
import { MEMBER_QUEUE_MAX, createMemberBuffer } from './member-buffer';
import type { Logger } from './log';

const silent: Logger = { info() {}, error() {} };
const event = {
  discord_id: '123456789012345678',
  type: 'join' as const,
  occurred_at: '2026-10-27T20:10:00.000+09:00',
};

describe('멤버 이벤트 버퍼', () => {
  it('거절된 배치는 다시 넣지 않고, 네트워크 오류는 다시 넣는다', async () => {
    let mode: 'reject' | 'retry' | 'ok' = 'reject';
    const buffer = createMemberBuffer(async () => {
      if (mode === 'reject') throw new ApiRequestError(400, 'VALIDATION_FAILED', false);
      if (mode === 'retry') throw new ApiRequestError(0, 'NETWORK', true);
    }, silent);
    buffer.push({ ...event, discord_id: 'bad' });
    buffer.push(event);
    await buffer.flush();
    expect(buffer.pending()).toBe(0);

    mode = 'retry';
    buffer.push(event);
    await buffer.flush();
    expect(buffer.pending()).toBe(1);
    mode = 'ok';
    await buffer.flush();
    expect(buffer.pending()).toBe(0);
    buffer.stop();
  });

  it('API가 계속 실패하면 큐 상한을 넘기지 않고 가장 오래된 것부터 버린다', async () => {
    const dropped: number[] = [];
    const logger: Logger = {
      info() {},
      error(msg, fields) {
        if (msg === 'member events dropped') dropped.push(Number(fields?.count));
      },
    };
    const buffer = createMemberBuffer(async () => {
      throw new ApiRequestError(503, 'INTERNAL_ERROR', true);
    }, logger);
    buffer.push(event);
    await buffer.flush();
    for (let i = 0; i < MEMBER_QUEUE_MAX + 5; i += 1) buffer.push(event);
    expect(buffer.pending()).toBe(MEMBER_QUEUE_MAX);
    expect(dropped.reduce((a, b) => a + b, 0)).toBe(6);
    buffer.stop();
  });
});
