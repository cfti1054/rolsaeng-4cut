import { ScrimDetail } from '@gcd/shared';
import { expect } from 'vitest';
import { call } from './s1-helpers';
import type { Who } from './s4-helpers';
import type { TestApp } from './test-app';

/** S6 테스트 공통 준비(DB 없이 FakePrisma에 행을 직접 심는다). 계약: _workspace/01_architect_contract.md(S6) 18절 backend */

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** JSON 응답 + 상태 확인 */
export async function json<T = unknown>(res: Response, status = 200): Promise<T> {
  const text = await res.text();
  expect({ status: res.status, text }).toMatchObject({ status });
  return (text ? JSON.parse(text) : undefined) as T;
}

/** ScrimDetail 응답(웹 D38: email·discord 없음) */
export async function detailOf(res: Response, status = 200): Promise<ScrimDetail> {
  const text = await res.text();
  expect({ status: res.status, text }).toMatchObject({ status });
  expect(text).not.toMatch(/email|discord/i);
  return ScrimDetail.parse(JSON.parse(text));
}

export const getScrim = async (app: TestApp, who: Who, id: string) => detailOf(await call(app, 'GET', `/scrims/${id}`, who.token));

export const revert = (app: TestApp, who: Who, scrimId: string, resultId: string, reason = '점수 입력 실수') =>
  call(app, 'POST', `/scrims/${scrimId}/result/revert`, who.token, { result_id: resultId, reason });

/** DB role만 바꾼다(토큰 claim은 그대로) — D263 강등·승격 흉내 */
export function setRole(app: TestApp, userId: string, role: 'member' | 'admin'): void {
  const u = app.prisma.users.find((x) => x.id === userId);
  if (!u) throw new Error('user 없음');
  u.role = role;
}

/** 감사 행(테이블 직접) */
export function auditRows(app: TestApp, action?: string) {
  return app.prisma.adminAuditLog.rows.filter((r) => action === undefined || r.action === action);
}

/** 이의 제기 행 직접 삽입. D281 이후 앱 코드는 이 표를 쓰지 않는다 — 「건드리지 않음」 회귀 테스트 전용 */
export function seedDispute(
  app: TestApp,
  o: { resultId: string; userId: string; status?: 'open' | 'resolved'; createdAt?: Date; reason?: string },
) {
  return app.prisma.scrimResultDispute.insert({
    scrimResultId: o.resultId,
    userId: o.userId,
    reason: o.reason ?? '이의 있음',
    status: o.status ?? 'open',
    createdAt: o.createdAt ?? app.clock.now(),
  });
}
