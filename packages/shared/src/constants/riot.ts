import { z } from 'zod';

// =============================================================================
// 라이엇 관련 상수(S1). 계약: _workspace/01_architect_contract.md
// 외부 API 경로·응답 형식은 integration이 공식 문서로 다시 확인한다(external-api-integration 2절).
// =============================================================================

/**
 * 랭크 티어(롤 솔로 랭크·롤체 공통). 라이엇 응답의 `tier` 문자열과 같은 값.
 * 순서는 낮은 티어 → 높은 티어. 문서 7-3 티어 점수(티어 × 400 + 디비전 × 100 + LP)는 S4에서
 * RIOT_TIER_ORDER·RIOT_DIVISION_ORDER로 계산한다.
 */
export const RiotTier = z.enum([
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
]);
export type RiotTier = z.infer<typeof RiotTier>;

/**
 * rank_snapshots.tier에 저장하는 값. 해당 큐 기록이 없으면 'UNRANKED'(division null, lp·wins·losses 0).
 */
export const RankTier = z.enum([...RiotTier.options, 'UNRANKED']);
export type RankTier = z.infer<typeof RankTier>;

/** 티어 순서 값(IRON 0 … CHALLENGER 9). UNRANKED는 순서가 없다(랭킹 제외 여부는 S4가 정한다). */
export const RIOT_TIER_ORDER: Readonly<Record<RiotTier, number>> = {
  IRON: 0,
  BRONZE: 1,
  SILVER: 2,
  GOLD: 3,
  PLATINUM: 4,
  EMERALD: 5,
  DIAMOND: 6,
  MASTER: 7,
  GRANDMASTER: 8,
  CHALLENGER: 9,
};

/** 디비전. 라이엇 응답의 `rank` 값(I … IV). */
export const RiotDivision = z.enum(['I', 'II', 'III', 'IV']);
export type RiotDivision = z.infer<typeof RiotDivision>;

/** 디비전 순서 값(IV 0 … I 3). 높을수록 상위. */
export const RIOT_DIVISION_ORDER: Readonly<Record<RiotDivision, number>> = {
  IV: 0,
  III: 1,
  II: 2,
  I: 3,
};

/** 디비전이 없는 상위 티어. 라이엇은 이 티어에도 rank='I'를 주지만 저장·응답은 division=null로 한다. */
export const RIOT_APEX_TIERS: readonly RiotTier[] = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];

/**
 * 티어 한 시점 값. rank_snapshots 한 행, 프로필 티어 카드에 공통으로 쓴다.
 * 규칙: tier가 UNRANKED이거나 RIOT_APEX_TIERS면 division=null, 그 외 티어는 division 필수.
 */
export const RankValue = z
  .object({
    tier: RankTier,
    division: RiotDivision.nullable(),
    lp: z.number().int().min(0),
    wins: z.number().int().min(0),
    losses: z.number().int().min(0),
  })
  .superRefine((v, ctx) => {
    const noDivision = v.tier === 'UNRANKED' || (RIOT_APEX_TIERS as readonly string[]).includes(v.tier);
    if (noDivision && v.division !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['division'], message: 'division: 이 티어는 null' });
    }
    if (!noDivision && v.division === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['division'], message: 'division: 필수' });
    }
  });
export type RankValue = z.infer<typeof RankValue>;

/**
 * rank_snapshots.queue 값. S1은 롤 솔로 랭크와 롤체 랭크만 저장한다.
 * (라이엇 응답 queueType 문자열과 같다)
 */
export const RankedQueue = z.enum(['RANKED_SOLO_5x5', 'RANKED_TFT']);
export type RankedQueue = z.infer<typeof RankedQueue>;

/** 게임 코드 → 티어 카드에 쓰는 큐. 라이엇 계정 게임(lol, tft)만 있다. */
export const RANKED_QUEUE_BY_GAME = {
  lol: 'RANKED_SOLO_5x5',
  tft: 'RANKED_TFT',
} as const satisfies Record<'lol' | 'tft', RankedQueue>;

/** Match-V5 솔로 랭크 큐 ID. 최근 전적·주 포지션은 이 큐만 쓴다(결정 D40). */
export const RIOT_SOLO_QUEUE_ID = 420;
/** 최근 전적 저장·주 포지션 표본 최대 경기 수(계정당) */
export const RECENT_MATCHES_MAX = 20;
/** 프로필 응답에 넣는 최근 전적 개수 */
export const PROFILE_RECENT_MATCHES_LIMIT = 10;
/** 최근 전적 캐시 유효 시간(문서 9장 6시간) */
export const RECENT_MATCHES_TTL_HOURS = 6;

/** 롤 포지션 코드. GAME_SEED lol.positions와 같은 값·순서(계약 테스트로 확인). 순서 = 동률 정렬 기준 */
export const LolPosition = z.enum(['top', 'jungle', 'mid', 'bot', 'support']);
export type LolPosition = z.infer<typeof LolPosition>;

/**
 * Match-V5 participant.teamPosition → LolPosition. 빈 문자열·그 밖의 값은 null(포지션 없음).
 */
export const RIOT_TEAM_POSITION_MAP: Readonly<Record<string, LolPosition>> = {
  TOP: 'top',
  JUNGLE: 'jungle',
  MIDDLE: 'mid',
  BOTTOM: 'bot',
  UTILITY: 'support',
};

export function toLolPosition(teamPosition: string | null | undefined): LolPosition | null {
  if (!teamPosition) return null;
  return RIOT_TEAM_POSITION_MAP[teamPosition] ?? null;
}

// -----------------------------------------------------------------------------
// 라이엇 ID와 소유 확인
// -----------------------------------------------------------------------------

/** 라이엇 ID 게임 이름 최대 길이(라이엇 규칙 3–16자, 이전 소환사명 이관 계정을 위해 최소 1자로 완화) */
export const RIOT_GAME_NAME_MAX = 16;
/** 태그 최대 길이(라이엇 규칙 3–5자, 최소 1자로 완화) */
export const RIOT_TAG_LINE_MAX = 5;

/**
 * 라이엇 ID 입력 `게임이름#태그` → `{ game_name, tag_line }`.
 * - 앞뒤 공백 제거, 마지막 `#` 기준으로 나눈다. 게임 이름 1–16자(`#` 제외), 태그 1–5자(문자·숫자).
 * - 대소문자는 그대로 둔다(라이엇 조회가 대소문자를 구분하지 않음). 저장되는 표시 이름은 Account-V1 응답 값을 쓴다.
 */
export const RiotIdInput = z
  .string()
  .max(64)
  .transform((raw, ctx) => {
    const s = raw.trim();
    const at = s.lastIndexOf('#');
    const gameName = at > 0 ? s.slice(0, at).trim() : '';
    const tagLine = at > 0 ? s.slice(at + 1).trim() : '';
    const ok =
      gameName.length >= 1 &&
      [...gameName].length <= RIOT_GAME_NAME_MAX &&
      !gameName.includes('#') &&
      /^[\p{L}\p{N}]{1,5}$/u.test(tagLine);
    if (!ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'riot_id: 게임이름#태그 형식(이름 1–16자, 태그 1–5자)' });
      return z.NEVER;
    }
    return { game_name: gameName, tag_line: tagLine };
  });
export type RiotIdInput = z.infer<typeof RiotIdInput>;

/** 화면 표시용 라이엇 ID 문자열 */
export function formatRiotId(id: { game_name: string; tag_line: string }): string {
  return `${id.game_name}#${id.tag_line}`;
}

/**
 * 소유 확인에 쓰는 프로필 아이콘 후보: 모든 계정이 기본으로 가진 아이콘 0–28.
 * integration은 실제 계정으로 바꿀 수 있는지 공식 자료로 확인하고 보고서에 적는다(계약 9절 확인 항목 I2).
 */
export const RIOT_VERIFICATION_ICON_IDS: readonly number[] = Array.from({ length: 29 }, (_, i) => i);

/** 소유 확인 제한 시간(초). 환경 변수 RIOT_VERIFICATION_TTL_SEC 기본값 */
export const RIOT_VERIFICATION_TTL_SEC_DEFAULT = 600;
/** 같은 소유 확인에 대해 "확인" 요청 최소 간격(초). 위반 시 RATE_LIMITED */
export const RIOT_VERIFICATION_CHECK_INTERVAL_SEC = 5;
/** 사용자당 하루(KST) 소유 확인 시작 최대 횟수. 위반 시 RATE_LIMITED */
export const RIOT_VERIFICATION_DAILY_START_LIMIT = 10;
