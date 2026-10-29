import { ConfirmRiotVerificationResponse, ErrorBody, LinkGameAccountResponse } from '@gcd/shared';
import { expect } from 'vitest';
import type { TestApp } from './test-app';

export async function devLogin(app: TestApp, username: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${app.base}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  const body = (await res.json()) as { access_token: string; user: { id: string } };
  return { token: body.access_token, userId: body.user.id };
}

export async function call(
  app: TestApp,
  method: string,
  path: string,
  token?: string,
  body?: unknown,
  extra: RequestInit = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${app.base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
    ...extra,
  });
}

export async function expectError(res: Response, status: number, code: string): Promise<ErrorBody> {
  const text = await res.text();
  expect({ status: res.status, body: text }).toMatchObject({ status });
  const body = ErrorBody.strict().parse(JSON.parse(text));
  expect(body.code).toBe(code);
  return body;
}

/** 라이엇 소유 확인 시작 → 아이콘 맞춤 → 확인까지. 반환: 확인 응답 */
export async function linkRiot(
  app: TestApp,
  token: string,
  name: string,
): Promise<ConfirmRiotVerificationResponse> {
  const start = await call(app, 'POST', '/me/game-accounts', token, { provider: 'riot', riot_id: `${name}#KR1` });
  expect(start.status).toBe(200);
  const body = LinkGameAccountResponse.parse(await start.json());
  if (body.provider !== 'riot') throw new Error('riot 응답 아님');
  const puuid = app.riot.accounts.get(name.toLowerCase());
  if (!puuid) throw new Error(`목에 없는 이름 ${name}`);
  app.riot.icons.set(puuid, body.verification.icon_id);
  const confirm = await call(app, 'POST', `/me/game-accounts/riot-verifications/${body.verification.id}/confirm`, token);
  expect(confirm.status).toBe(200);
  return ConfirmRiotVerificationResponse.parse(await confirm.json());
}

/** 응답 원문에 외부 식별자(가짜 PUUID·스팀 ID·매치 ID)가 없는지 */
export function expectNoExternalIds(text: string): void {
  expect(text).not.toMatch(/FAKE-PUUID/);
  expect(text).not.toMatch(/7656119\d{10}/);
  expect(text).not.toMatch(/KR_\d+/);
  expect(text).not.toMatch(/external_id|puuid/i);
}
