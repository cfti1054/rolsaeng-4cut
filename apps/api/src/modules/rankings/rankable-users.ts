import { Prisma } from '@prisma/client';

/**
 * 「순위 대상 사용자」 조건의 단일 정의(계약 S4 5절 D161, S5 1-3·D220). 티어·ELO·활동·플레이타임 계산, 시즌 종료,
 * 홈 「이번 주 활동 멤버」가 모두 이 값을 쓴다.
 * S5: 서버를 나간 회원(users.left_at 있음)은 순위 대상이 아니다. 로그인·참가·프로필은 막지 않는다(Q8).
 */
export const rankableUserWhere = { leftAt: null } satisfies Prisma.UserWhereInput;

/**
 * 원시 SQL용 같은 조건(티어 스냅샷·활동 집계·플레이타임처럼 Prisma where를 쓸 수 없는 쿼리).
 * **users 별칭은 반드시 `u`**: `JOIN users u ON u.id = … AND ${rankableUserSql}` 형태로만 쓴다.
 */
export const rankableUserSql = Prisma.sql`u.left_at IS NULL`;
