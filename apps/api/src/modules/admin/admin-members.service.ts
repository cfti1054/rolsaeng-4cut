import { Inject, Injectable } from '@nestjs/common';
import { adminMemberStatus, computeScrimRestriction, noShowLookbackStart, planRoleChange } from '@gcd/core';
import {
  AdminMemberItem,
  AdminMemberSort,
  type ChangeMemberRoleRequest,
  type ListAdminMembersQuery,
  ListAdminMembersResponse,
  deletedMemberNickname,
  isLinkedDiscordId,
} from '@gcd/shared';
import { Prisma, type User } from '@prisma/client';
import { z } from 'zod';
import { advisoryXactLock } from '../../common/advisory-lock';
import { AppError } from '../../common/app-error';
import { writeAudit } from '../../common/audit';
import { APP_CLOCK, type Clock } from '../../common/clock';
import type { AuthUser } from '../../common/decorators/current-user';
import { invalidCursor } from '../../common/list-cursor';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { ScrimRestrictionService } from '../scrims/scrim-restriction.service';
import { ScrimViews } from '../scrims/scrim-views.service';
import { marksByUser } from './admin-review.service';

/** 역할 변경 직렬화 advisory 키(계약 S6 12-2, D265) */
export const ADMIN_ROLES_LOCK_KEY = 'admin-roles';

type Db = Pick<Prisma.TransactionClient, 'scrimPlayer' | '$queryRaw'>;

/** 멤버 목록 커서 = base64url(JSON { o: offset, s: sort })(D266). sort가 다르면 VALIDATION_FAILED(path cursor) */
const MemberCursor = z.object({ o: z.number().int().min(0), s: AdminMemberSort }).strict();

export function encodeMemberCursor(offset: number, sort: AdminMemberSort): string {
  return Buffer.from(JSON.stringify({ o: offset, s: sort })).toString('base64url');
}

export function decodeMemberCursor(raw: string, sort: AdminMemberSort): number {
  let json: unknown;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error('base64url 아님');
    json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  const p = MemberCursor.safeParse(json);
  if (!p.success) throw invalidCursor();
  if (p.data.s !== sort) throw invalidCursor('cursor: 다른 정렬의 커서');
  return p.data.o;
}

/** ILIKE 부분 일치 패턴(`\`·`%`·`_` 이스케이프, ESCAPE '\') */
export function likeContainsPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

type Built = { user: User; item: AdminMemberItem };

/**
 * S6 멤버 관리(계약 S6 12-1·12-2, D263–D267). 웹 응답에 discord_id는 없다(D38) — discord_username·discord_linked만.
 */
@Injectable()
export class AdminMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly views: ScrimViews,
    private readonly restriction: ScrimRestrictionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  /** D239·D267 scrim_count(joined, 결과 approved, 취소 아닌 내전, 기간 없음). 원시 SQL 1회 */
  private async scrimCounts(db: Db, userIds: readonly string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const rows = await db.$queryRaw<{ user_id: string; scrim_count: unknown }[]>`
      /* gcd:member-scrim-counts */
      SELECT sp.user_id::text AS user_id, COUNT(DISTINCT s.id)::int AS scrim_count
      FROM scrim_players sp
      JOIN scrims s ON s.id = sp.scrim_id AND s.status <> 'cancelled'
      WHERE sp.status = 'joined'
        AND EXISTS (SELECT 1 FROM scrim_results r WHERE r.scrim_id = s.id AND r.status = 'approved')
        AND sp.user_id IN (${Prisma.join(userIds.map((id) => Prisma.sql`${id}::uuid`))})
      GROUP BY sp.user_id`;
    return new Map(rows.map((r) => [r.user_id, Number(r.scrim_count)]));
  }

  /** 회원 행 → AdminMemberItem(노쇼 조회 1회 + scrim_count 1회) */
  private async build(db: Db, users: User[], now: Date): Promise<Built[]> {
    if (users.length === 0) return [];
    const ids = users.map((u) => u.id);
    const policy = this.restriction.policy;
    const counts = await this.scrimCounts(db, ids);
    const marks = marksByUser(
      await db.scrimPlayer.findMany({
        where: { userId: { in: ids }, status: 'no_show', noShowMarkedAt: { gt: noShowLookbackStart(now, policy) } },
        select: { userId: true, noShowMarkedAt: true },
      }),
    );
    const refs = new Map(users.map((u) => [u.id, u]));
    return users.map((u) => {
      const state = computeScrimRestriction(marks.get(u.id) ?? [], now, policy);
      const restrictedUntil = state.restricted && state.until ? state.until : null;
      const item = AdminMemberItem.parse({
        user: this.views.userRef(refs, u.id),
        role: u.role,
        role_locked: u.discordId !== null && this.config.adminDiscordIds.has(u.discordId),
        discord_linked: isLinkedDiscordId(u.discordId),
        discord_username: u.discordUsername,
        joined_at: u.createdAt.toISOString(),
        last_login_at: u.lastLoginAt?.toISOString() ?? null,
        scrim_count: counts.get(u.id) ?? 0,
        no_show_30d: state.recentCount,
        restricted_until: restrictedUntil?.toISOString() ?? null,
        left_at: u.leftAt?.toISOString() ?? null,
        status: adminMemberStatus({ leftAt: u.leftAt, restrictedUntil, now }),
      });
      return { user: u, item };
    });
  }

  /** GET /admin/members — 기준 집합 users 전체(탈퇴 포함), q·role 필터, sort별 정렬(+ id ASC), 오프셋 커서 */
  async list(q: ListAdminMembersQuery): Promise<ListAdminMembersResponse> {
    const now = this.clock.now();
    const offset = q.cursor === undefined ? 0 : decodeMemberCursor(q.cursor, q.sort);
    let idFilter: string[] | undefined;
    if (q.q !== undefined) {
      const pattern = likeContainsPattern(q.q);
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        /* gcd:admin-member-search */
        SELECT u.id::text AS id FROM users u
        WHERE u.deleted_at IS NULL AND (u.nickname ILIKE ${pattern} ESCAPE '\\' OR u.discord_username ILIKE ${pattern} ESCAPE '\\')`;
      idFilter = rows.map((r) => r.id);
      if (idFilter.length === 0) return ListAdminMembersResponse.parse({ items: [], next_cursor: null });
    }
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, ...(q.role ? { role: q.role } : {}), ...(idFilter ? { id: { in: idFilter } } : {}) },
    });
    const built = await this.build(this.prisma, users, now);
    const time = (d: string | null) => (d === null ? null : Date.parse(d));
    const sorted = [...built].sort((a, b) => {
      let c = 0;
      switch (q.sort) {
        case 'joined_desc':
          c = b.user.createdAt.getTime() - a.user.createdAt.getTime();
          break;
        case 'nickname_asc':
          c = a.user.nickname < b.user.nickname ? -1 : a.user.nickname > b.user.nickname ? 1 : 0;
          break;
        case 'scrims_desc':
          c = b.item.scrim_count - a.item.scrim_count;
          break;
        case 'no_show_desc':
          c = b.item.no_show_30d - a.item.no_show_30d;
          break;
        case 'last_login_desc': {
          const at = time(a.item.last_login_at);
          const bt = time(b.item.last_login_at);
          c = at === bt ? 0 : at === null ? 1 : bt === null ? -1 : bt - at;
          break;
        }
      }
      return c !== 0 ? c : byId(a.user, b.user);
    });
    const page = sorted.slice(offset, offset + q.limit);
    const next = offset + q.limit < sorted.length ? encodeMemberCursor(offset + q.limit, q.sort) : null;
    return ListAdminMembersResponse.parse({ items: page.map((b) => b.item), next_cursor: next });
  }

  /**
   * PATCH /admin/members/:id/role(12-2). $transaction: admin-roles advisory → 요청자 role 재확인(admin 아니면 FORBIDDEN) →
   * 대상(없으면 NOT_FOUND) → admin 수 → core planRoleChange → change면 update + 감사, noop이면 그대로.
   * 강등된 회원의 리프레시 토큰은 폐기하지 않는다(JwtGuard가 DB role을 읽는다, D263).
   */
  async changeRole(admin: AuthUser, targetId: string, body: ChangeMemberRoleRequest): Promise<AdminMemberItem> {
    const now = this.clock.now();
    const built = await this.prisma.$transaction(
      async (tx) => {
        await advisoryXactLock(tx, ADMIN_ROLES_LOCK_KEY);
        const actor = await tx.user.findUnique({ where: { id: admin.id } });
        if (!actor || actor.role !== 'admin') throw new AppError('FORBIDDEN');
        const target = await tx.user.findUnique({ where: { id: targetId } });
        if (!target) throw new AppError('NOT_FOUND');
        const adminCount = await tx.user.count({ where: { role: 'admin' } });
        const plan = planRoleChange({
          actorId: admin.id,
          targetId: target.id,
          currentRole: target.role,
          nextRole: body.role,
          targetLocked: target.discordId !== null && this.config.adminDiscordIds.has(target.discordId),
          adminCount,
        });
        if (plan.kind === 'error') throw new AppError(plan.code);
        let row = target;
        if (plan.kind === 'change') {
          row = await tx.user.update({ where: { id: target.id }, data: { role: body.role } });
          await writeAudit(tx, {
            actorId: admin.id,
            action: 'member.role_change',
            targetId: target.id,
            summary: `${target.nickname} 역할을 ${body.role === 'admin' ? '운영진으로' : '멤버로'} 변경`,
            details: { from: target.role, to: body.role },
            at: now,
          });
        }
        const [b] = await this.build(tx, [row], now);
        return b as Built;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    return built.item;
  }

  /**
   * DELETE /admin/members/:id — 익명화 삭제(S6 후속). 회원 행과 내전 기록은 남기고 로그인 정보만 지운다.
   * $transaction: admin-roles advisory(역할 변경과 직렬화) → 요청자 role 재확인 → 대상(없거나 이미 삭제됐으면 NOT_FOUND) →
   * 운영진이면 ADMIN_DELETE_ADMIN(본인·ADMIN_DISCORD_IDS 포함, 먼저 멤버로 내린다) →
   * 리프레시 토큰·게임 계정(전적·플레이타임 캐시 cascade)·Riot 인증·동기화 요청 삭제 →
   * 닉네임을 「(Del) 원래닉네임」으로, 디스코드·이메일 값을 비우고 deleted_at 기록. 레이팅·내전 기록은 그대로 둔다.
   * 감사 행 member.delete는 관리 추적을 위해 원래 닉네임을 details에 남긴다.
   */
  async remove(admin: AuthUser, targetId: string): Promise<void> {
    const now = this.clock.now();
    await this.prisma.$transaction(
      async (tx) => {
        await advisoryXactLock(tx, ADMIN_ROLES_LOCK_KEY);
        const actor = await tx.user.findUnique({ where: { id: admin.id } });
        if (!actor || actor.role !== 'admin') throw new AppError('FORBIDDEN');
        const target = await tx.user.findUnique({ where: { id: targetId } });
        if (!target || target.deletedAt) throw new AppError('NOT_FOUND');
        if (target.role === 'admin') throw new AppError('ADMIN_DELETE_ADMIN');
        await tx.refreshToken.deleteMany({ where: { userId: target.id } });
        await tx.gameAccount.deleteMany({ where: { userId: target.id } });
        await tx.riotLinkVerification.deleteMany({ where: { userId: target.id } });
        await tx.gameAccountSyncRequest.deleteMany({ where: { userId: target.id } });
        await tx.user.update({
          where: { id: target.id },
          data: {
            nickname: deletedMemberNickname(target.nickname, target.id),
            email: null,
            discordId: null,
            discordUsername: null,
            discordGlobalName: null,
            discordAvatar: null,
            discordGuildVerifiedAt: null,
            deletedAt: now,
          },
        });
        await writeAudit(tx, {
          actorId: admin.id,
          action: 'member.delete',
          targetId: target.id,
          summary: `${target.nickname} 회원 삭제`,
          details: {
            id: target.id,
            nickname: target.nickname,
            role: target.role,
            joined_at: target.createdAt,
            last_login_at: target.lastLoginAt,
          },
          at: now,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
}
