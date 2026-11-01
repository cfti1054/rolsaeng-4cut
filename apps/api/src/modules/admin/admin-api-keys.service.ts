import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AdminApiKeyItem,
  ApiKeyScope,
  type CreateApiKeyRequest,
  CreateApiKeyResponse,
  ListAdminApiKeysResponse,
} from '@gcd/shared';
import type { ApiKey } from '@prisma/client';
import { generateApiKey } from '../../common/api-key';
import { AppError } from '../../common/app-error';
import { auditQuote, writeAudit } from '../../common/audit';
import { APP_CLOCK, type Clock } from '../../common/clock';
import type { AuthUser } from '../../common/decorators/current-user';
import { PrismaService } from '../../prisma/prisma.service';
import { ScrimViews } from '../scrims/scrim-views.service';

/**
 * S6 봇 API 키 웹 발급·목록·폐기(계약 S6 12-4, D272). 생성 함수는 CLI와 같은 generateApiKey(S5 D221).
 * 원문은 발급 응답에만 있다(저장·로그·감사에 원문·해시 없음). 키 행은 지우지 않는다(activity_logs.api_key_id 감사 유지, S5 D223).
 */
@Injectable()
export class AdminApiKeysService {
  private readonly log = new Logger('AdminApiKeysService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly views: ScrimViews,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  private async items(rows: ApiKey[]): Promise<AdminApiKeyItem[]> {
    const users = await this.views.usersById(rows.flatMap((r) => (r.createdById ? [r.createdById] : [])));
    return rows.map((r) => {
      const scopes = r.scopes.flatMap((s) => {
        const p = ApiKeyScope.safeParse(s);
        if (!p.success) {
          this.log.warn(`api_keys.scopes에 모르는 값 제외 key_prefix=${r.keyPrefix} scope=${s}`);
          return [];
        }
        return [p.data];
      });
      return AdminApiKeyItem.parse({
        id: r.id,
        name: r.name,
        key_prefix: r.keyPrefix,
        scopes,
        last_used_at: r.lastUsedAt?.toISOString() ?? null,
        revoked_at: r.revokedAt?.toISOString() ?? null,
        created_by: r.createdById && users.has(r.createdById) ? this.views.userRef(users, r.createdById) : null,
        created_at: r.createdAt.toISOString(),
      });
    });
  }

  /** GET /admin/api-keys — 전체(폐기 포함), 폐기 안 된 것 먼저 → created_at DESC → id DESC. 페이징 없음 */
  async list(): Promise<ListAdminApiKeysResponse> {
    const rows = await this.prisma.apiKey.findMany();
    const sorted = [...rows].sort((a, b) => {
      const ra = a.revokedAt === null ? 0 : 1;
      const rb = b.revokedAt === null ? 0 : 1;
      if (ra !== rb) return ra - rb;
      const t = b.createdAt.getTime() - a.createdAt.getTime();
      if (t !== 0) return t;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });
    return ListAdminApiKeysResponse.parse({ items: await this.items(sorted), next_cursor: null });
  }

  /** POST /admin/api-keys — 201 { api_key, key(원문 1회) } */
  async create(admin: AuthUser, body: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
    const now = this.clock.now();
    const k = generateApiKey();
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.apiKey.create({
        data: { name: body.name, keyHash: k.hash, keyPrefix: k.prefix, scopes: body.scopes, createdById: admin.id, createdAt: now },
      });
      await writeAudit(tx, {
        actorId: admin.id,
        action: 'api_key.create',
        targetId: created.id,
        summary: `API 키 ${auditQuote(created.name)} 발급`,
        details: { name: created.name, key_prefix: created.keyPrefix, scopes: body.scopes },
        at: now,
      });
      return created;
    });
    this.log.log(`API 키 발급 key_prefix=${row.keyPrefix} by=${admin.id}`);
    const [item] = await this.items([row]);
    return CreateApiKeyResponse.parse({ api_key: item, key: k.raw });
  }

  /** POST /admin/api-keys/:id/revoke — 멱등. 이미 폐기된 키는 그대로 200(감사 없음). 없으면 NOT_FOUND */
  async revoke(admin: AuthUser, id: string): Promise<AdminApiKeyItem> {
    const now = this.clock.now();
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.apiKey.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now } });
      const cur = await tx.apiKey.findUnique({ where: { id } });
      if (!cur) throw new AppError('NOT_FOUND');
      if (r.count === 1) {
        await writeAudit(tx, {
          actorId: admin.id,
          action: 'api_key.revoke',
          targetId: id,
          summary: `API 키 ${auditQuote(cur.name)} 폐기`,
          details: { name: cur.name, key_prefix: cur.keyPrefix },
          at: now,
        });
      }
      return cur;
    });
    const [item] = await this.items([row]);
    return item as AdminApiKeyItem;
  }
}
