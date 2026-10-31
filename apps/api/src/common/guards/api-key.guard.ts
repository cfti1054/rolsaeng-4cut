import { type CanActivate, type ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  API_KEY_LAST_USED_WRITE_INTERVAL_SEC,
  API_KEY_PATTERN,
  BOT_API_KEY_HEADER,
  ApiKeyScope,
} from '@gcd/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { hashApiKey } from '../api-key';
import { AppError } from '../app-error';
import { APP_CLOCK, type Clock } from '../clock';
import { BOT_SCOPE_KEY, type BotRequest } from '../decorators/bot-scope.decorator';

/**
 * 봇 API 키 검사(계약 S5 6-1). `X-API-Key`만 본다(JWT·쿠키는 읽지 않는다).
 * 1. 헤더 없음·형식 불일치 → API_KEY_INVALID
 * 2. SHA-256 해시로 조회, 없음·폐기 → API_KEY_INVALID
 * 3. 핸들러 scope가 키 scopes에 없음 → API_KEY_SCOPE_MISSING. scope 메타데이터가 없는 핸들러도 거부
 * 4. last_used_at은 API_KEY_LAST_USED_WRITE_INTERVAL_SEC보다 오래됐을 때만 조건부로 쓴다(실패는 로그만)
 * 키 원문은 로그에 남기지 않는다(key_prefix만).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly log = new Logger('ApiKeyGuard');

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<BotRequest>();
    const raw = req.headers[BOT_API_KEY_HEADER];
    if (typeof raw !== 'string' || !API_KEY_PATTERN.test(raw)) throw new AppError('API_KEY_INVALID');

    const key = await this.prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(raw) } });
    if (!key || key.revokedAt !== null) throw new AppError('API_KEY_INVALID');

    const scope = this.reflector.getAllAndOverride<ApiKeyScope | undefined>(BOT_SCOPE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (scope === undefined) {
      this.log.error(`scope 메타데이터 없는 봇 핸들러: ${ctx.getClass().name}.${ctx.getHandler().name}`);
      throw new AppError('API_KEY_SCOPE_MISSING');
    }
    const scopes = key.scopes.flatMap((s) => {
      const parsed = ApiKeyScope.safeParse(s);
      return parsed.success ? [parsed.data] : [];
    });
    if (!scopes.includes(scope)) throw new AppError('API_KEY_SCOPE_MISSING');

    await this.touch(key.id, key.keyPrefix, key.lastUsedAt);
    req.apiKey = { id: key.id, name: key.name, scopes };
    return true;
  }

  private async touch(id: string, prefix: string, lastUsedAt: Date | null): Promise<void> {
    const now = this.clock.now();
    const intervalMs = API_KEY_LAST_USED_WRITE_INTERVAL_SEC * 1000;
    if (lastUsedAt !== null && now.getTime() - lastUsedAt.getTime() < intervalMs) return;
    try {
      await this.prisma.apiKey.updateMany({
        where: { id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: new Date(now.getTime() - intervalMs) } }] },
        data: { lastUsedAt: now },
      });
    } catch (err) {
      this.log.warn(`last_used_at 기록 실패 key_prefix=${prefix}: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }
}
