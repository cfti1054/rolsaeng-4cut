import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@gcd/shared';

export const ROLES_KEY = 'gcd:roles';

/** 허용 역할. RolesGuard가 JwtGuard 뒤에서 JwtGuard가 DB에서 읽은 role로 검사한다(S6 D263). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
