import { ApiPath, GetCalendarResponse, type GameCode } from '@gcd/shared';
import { apiClient } from './index';

/**
 * S6 후속 커뮤니티 캘린더 읽기(계약 S6 23-2, 멤버 전원). 응답은 shared zod 스키마로 parse된다.
 * 일정 쓰기는 기존 /admin/events…(lib/api/admin.ts)를 그대로 쓴다(D284).
 */

/** GET /calendar?month=&game= — month 생략 = 오늘(KST) 달(서버 계산) */
export function getCalendar(p: { month?: string; game?: GameCode } = {}, signal?: AbortSignal) {
  const q = new URLSearchParams();
  if (p.month) q.set('month', p.month);
  if (p.game) q.set('game', p.game);
  const s = q.toString();
  return apiClient.request(`${ApiPath.calendar}${s ? `?${s}` : ''}`, GetCalendarResponse, { signal });
}
