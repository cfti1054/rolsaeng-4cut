import { BOT_API_KEY_HEADER, PostBotActivityResponse } from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import { ApiRequestError, BotApiClient, joinUrl, retryDelayMs } from './api-client';

const KEY = `gcd_${'a'.repeat(43)}`;

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

const activityOk = {
  results: [{ idempotency_key: 'voice-1', status: 'created', reason: null }],
  counts: { created: 1, duplicate: 0, unlinked: 0, rejected: 0 },
};

describe('API 클라이언트', () => {
  it('베이스 주소 뒤의 슬래시와 경로를 붙인다', () => {
    expect(joinUrl('https://api.example/api/v1/', '/bot/activity')).toBe('https://api.example/api/v1/bot/activity');
  });

  it('성공 응답을 스키마로 확인하고 키 헤더를 넣는다', async () => {
    const seen: RequestInit[] = [];
    const client = new BotApiClient({
      baseUrl: 'https://api.example/api/v1',
      apiKey: KEY,
      fetch: async (_url, init) => {
        seen.push(init ?? {});
        return jsonResponse(200, activityOk);
      },
    });
    const res = await client.postActivity({
      events: [
        {
          idempotency_key: 'voice-123456789012345678-20261027T201000',
          discord_id: '123456789012345678',
          type: 'voice',
          started_at: '2026-10-27T20:10:00.000+09:00',
          duration_sec: 60,
        },
      ],
    });
    expect(PostBotActivityResponse.parse(res).counts.created).toBe(1);
    const headers = seen[0]?.headers as Record<string, string>;
    expect(headers[BOT_API_KEY_HEADER]).toBe(KEY);
  });

  it('5xx는 다시 시도하고 401은 한 번만 보낸다', async () => {
    let calls = 0;
    const slept: number[] = [];
    const client = new BotApiClient({
      baseUrl: 'https://api.example/api/v1',
      apiKey: KEY,
      sleep: async (ms) => {
        slept.push(ms);
      },
      fetch: async () => {
        calls += 1;
        if (calls === 1) return jsonResponse(500, { code: 'INTERNAL_ERROR', message: 'x' });
        return jsonResponse(200, activityOk);
      },
    });
    await client.postActivity({
      events: [
        {
          idempotency_key: 'voice-123456789012345678-20261027T201000',
          discord_id: '123456789012345678',
          type: 'voice',
          started_at: '2026-10-27T20:10:00.000+09:00',
          duration_sec: 60,
        },
      ],
    });
    expect(calls).toBe(2);
    expect(slept).toEqual([retryDelayMs(0, null)]);

    let denied = 0;
    const deniedClient = new BotApiClient({
      baseUrl: 'https://api.example/api/v1',
      apiKey: KEY,
      fetch: async () => {
        denied += 1;
        return jsonResponse(401, { code: 'API_KEY_INVALID', message: 'no' });
      },
    });
    await expect(
      deniedClient.putPresence({
        captured_at: '2026-10-27T20:10:00.000+09:00',
        voice_member_count: 0,
        playing: [],
      }),
    ).rejects.toMatchObject({ status: 401, code: 'API_KEY_INVALID', retryable: false });
    expect(denied).toBe(1);
  });

  it('형식은 맞는데 스키마가 다르면 다시 시도하지 않는다', async () => {
    let calls = 0;
    const client = new BotApiClient({
      baseUrl: 'https://api.example/api/v1',
      apiKey: KEY,
      fetch: async () => {
        calls += 1;
        return jsonResponse(200, { nope: true });
      },
    });
    await expect(client.pendingNotices()).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toBe(1);
  });
});
