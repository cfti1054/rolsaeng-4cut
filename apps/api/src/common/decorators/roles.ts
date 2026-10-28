import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@gcd/shared';

export const ROLES_KEY = 'gcd:roles';

/** 허용 역할. RolesGuard가 JwtGuard 뒤에서 토큰의 role 클레임으로 검사한다. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
