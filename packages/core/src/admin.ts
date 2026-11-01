import type { AdminMemberStatus, UserRole } from '@gcd/shared';
import { assertValidDate } from './time';

// =============================================================================
// S6 멤버 관리(계약 S6 12-1·12-2, D264·D265). I/O 없음.
// =============================================================================

/**
 * 역할 변경 판정(12-2). 순서: next === current → noop / actor === target → ADMIN_SELF_ROLE_CHANGE /
 * 강등(admin → member) && targetLocked → ADMIN_ROLE_LOCKED / 강등 && adminCount ≤ 1 → ADMIN_LAST_ADMIN / 그 외 change.
 * adminCount = 변경 전 admin 수(0 이상 정수, 아니면 RangeError — 다른 판정보다 먼저 검사).
 */
export function planRoleChange(input: {
  actorId: string;
  targetId: string;
  currentRole: UserRole;
  nextRole: UserRole;
  targetLocked: boolean;
  adminCount: number;
}): { kind: 'noop' } | { kind: 'change' } | { kind: 'error'; code: 'ADMIN_SELF_ROLE_CHANGE' | 'ADMIN_ROLE_LOCKED' | 'ADMIN_LAST_ADMIN' } {
  const { actorId, targetId, currentRole, nextRole, targetLocked, adminCount } = input;
  if (!Number.isInteger(adminCount) || adminCount < 0) {
    throw new RangeError(`adminCount: 0 이상의 정수여야 함 (${adminCount})`);
  }
  if (nextRole === currentRole) return { kind: 'noop' };
  if (actorId === targetId) return { kind: 'error', code: 'ADMIN_SELF_ROLE_CHANGE' };
  const demote = currentRole === 'admin' && nextRole !== 'admin';
  if (demote && targetLocked) return { kind: 'error', code: 'ADMIN_ROLE_LOCKED' };
  if (demote && adminCount <= 1) return { kind: 'error', code: 'ADMIN_LAST_ADMIN' };
  return { kind: 'change' };
}

/** 멤버 상태(12-1): left(leftAt 있음) > restricted(restrictedUntil > now) > active */
export function adminMemberStatus(input: { leftAt: Date | null; restrictedUntil: Date | null; now: Date }): AdminMemberStatus {
  const { leftAt, restrictedUntil, now } = input;
  assertValidDate(now, 'now');
  if (leftAt != null) return 'left';
  if (restrictedUntil != null) {
    assertValidDate(restrictedUntil, 'restrictedUntil');
    if (restrictedUntil.getTime() > now.getTime()) return 'restricted';
  }
  return 'active';
}
