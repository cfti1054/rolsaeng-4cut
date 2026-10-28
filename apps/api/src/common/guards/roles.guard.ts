import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@gcd/shared';
import { AppError } from '../app-error';
import type { AuthedRequest } from '../decorators/current-user';
import { ROLES_KEY } from '../decorators/roles';

/** `@UseGuards(JwtGuard, RolesGuard)` + `@Roles('admin')`. 역할 부족 → FORBIDDEN. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.authUser) throw new AppError('UNAUTHENTICATED');
    if (!roles.includes(req.authUser.role)) throw new AppError('FORBIDDEN');
    return true;
  }
}
