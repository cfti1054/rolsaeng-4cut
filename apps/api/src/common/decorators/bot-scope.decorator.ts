import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { ApiKeyScope } from '@gcd/shared';
import type { Request } from 'express';

export const BOT_SCOPE_KEY = 'gcd:bot-scope';

/** ApiKeyGuard가 요청에 붙이는 키 정보(원문·해시 없음) */
export interface BotApiKey {
  id: string;
  name: string;
  scopes: ApiKeyScope[];
}

export type BotRequest = Request & { apiKey?: BotApiKey };

/**
 * 봇 엔드포인트에 필요한 scope(계약 S5 6-1). 값은 shared BOT_ENDPOINT_SCOPE에서 가져온다.
 * `@UseGuards(ApiKeyGuard)`가 붙은 핸들러에 이 메타데이터가 없으면 가드가 거부한다(설정 실수 방지).
 */
export const BotScope = (scope: ApiKeyScope) => SetMetadata(BOT_SCOPE_KEY, scope);

/** ApiKeyGuard 뒤에서 키 정보를 꺼낸다 */
export const CurrentApiKey = createParamDecorator((_data: unknown, ctx: ExecutionContext): BotApiKey => {
  const req = ctx.switchToHttp().getRequest<BotRequest>();
  if (!req.apiKey) throw new Error('CurrentApiKey는 ApiKeyGuard 뒤에서만 쓸 수 있습니다.');
  return req.apiKey;
});
