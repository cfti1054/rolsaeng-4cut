import type { Prisma } from '@prisma/client';

/**
 * 「순위 대상 사용자」 조건의 단일 정의(계약 S4 5절, D161). 티어·ELO 계산·시즌 종료가 모두 이 값을 쓴다.
 * 탈퇴·비활성 상태 컬럼이 아직 없어 조건은 「사용자 행이 존재함」이다(삭제는 Cascade).
 * S5에서 users.left_at이 생기면 여기만 바꾼다(17절 Q4).
 */
export const rankableUserWhere = {} satisfies Prisma.UserWhereInput;
