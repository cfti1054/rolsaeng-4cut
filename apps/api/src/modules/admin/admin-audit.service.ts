import { Injectable, Logger } from '@nestjs/common';
import {
  AdminAuditAction,
  AdminAuditLogItem,
  AdminAuditTargetType,
  type ListAdminAuditLogsQuery,
  ListAdminAuditLogsResponse,
} from '@gcd/shared';
import type { Prisma } from '@prisma/client';
import { cursorDate, cursorId, decodeListCursor, encodeListCursor, pageOf } from '../../common/list-cursor';
import { PrismaService } from '../../prisma/prisma.service';
import { ScrimViews } from '../scrims/scrim-views.service';

/** S6 GET /admin/audit-logs(계약 S6 10절). created_at DESC, id DESC, action 필터. 수정·삭제 API 없음 */
@Injectable()
export class AdminAuditService {
  private readonly log = new Logger('AdminAuditService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly views: ScrimViews,
  ) {}

  async list(q: ListAdminAuditLogsQuery): Promise<ListAdminAuditLogsResponse> {
    const and: Prisma.AdminAuditLogWhereInput[] = [];
    if (q.action !== undefined) and.push({ action: q.action });
    if (q.cursor !== undefined) {
      const [c, id] = decodeListCursor(q.cursor, 'audit-logs', 2);
      const at = cursorDate(c);
      and.push({ OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursorId(id) } }] });
    }
    const rows = await this.prisma.adminAuditLog.findMany({
      where: and.length > 0 ? { AND: and } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const page = pageOf(rows, q.limit, (r) => encodeListCursor('audit-logs', [r.createdAt.toISOString(), r.id]));
    const users = await this.views.usersById(page.items.flatMap((r) => (r.actorId ? [r.actorId] : [])));
    const items = page.items.flatMap((r) => {
      const action = AdminAuditAction.safeParse(r.action);
      const target = AdminAuditTargetType.safeParse(r.targetType);
      if (!action.success || !target.success) {
        // text 컬럼이라 지금 enum에 없는 값이 있을 수 있다(수동 입력·이후 버전). 목록에서 빼고 로그
        this.log.warn(`감사 행 action·target_type을 알 수 없어 제외 id=${r.id} action=${r.action}`);
        return [];
      }
      const details =
        r.details !== null && typeof r.details === 'object' && !Array.isArray(r.details) ? (r.details as Record<string, unknown>) : {};
      return [
        AdminAuditLogItem.parse({
          id: r.id,
          actor: r.actorId && users.has(r.actorId) ? this.views.userRef(users, r.actorId) : null,
          action: action.data,
          target_type: target.data,
          target_id: r.targetId,
          summary: r.summary,
          details,
          created_at: r.createdAt.toISOString(),
        }),
      ];
    });
    return ListAdminAuditLogsResponse.parse({ items, next_cursor: page.next_cursor });
  }
}
