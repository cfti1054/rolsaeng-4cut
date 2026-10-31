import { GAME_PROVIDER_BY_CODE, GameCode } from '@gcd/shared';
import { Prisma } from '@prisma/client';
import { rankableUserSql } from './rankable-users';

/** 스팀 제공자의 games.code(코드 문자열을 SQL에 박지 않는다, 계약 S5 7-2) */
export const STEAM_GAME_CODE: GameCode = (Object.keys(GAME_PROVIDER_BY_CODE) as GameCode[]).find(
  (c) => GAME_PROVIDER_BY_CODE[c] === 'steam',
) as GameCode;

/**
 * 플레이타임 「보유자」의 단일 정의(계약 S5 7절, D234). 대표(is_primary)·확인된(verified) 스팀 계정,
 * 순위 대상 회원(rankableUserSql, 탈퇴 제외), minutes_total > 0.
 * 플레이타임 랭킹 행(7-2), 미리 갱신 대상 상위 app(7절), `GET /steam-apps` 보유 게임·owner_count(7-4)가 함께 쓴다(복제 금지).
 *
 * **별칭 고정**: `sp` = steam_playtime, `ga` = game_accounts, `g` = games, `u` = users.
 * 쓰는 법: `FROM ${playtimeHoldersFromSql} WHERE ${playtimeHolderWhereSql} AND …`
 * 바인딩 값 순서: 스팀 게임 코드 1개(이 조각) → 호출부 값.
 */
export const playtimeHoldersFromSql = Prisma.sql`steam_playtime sp
      JOIN game_accounts ga ON ga.id = sp.game_account_id AND ga.is_primary AND ga.verified
      JOIN games g ON g.id = ga.game_id AND g.code = ${STEAM_GAME_CODE}
      JOIN users u ON u.id = ga.user_id AND ${rankableUserSql}`;

/** 보유자 행 조건(위 FROM 조각과 함께 쓴다) */
export const playtimeHolderWhereSql = Prisma.sql`sp.minutes_total > 0`;
