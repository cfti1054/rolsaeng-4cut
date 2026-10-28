import { z } from 'zod';

/** 모든 엔티티 ID. 문서 5장: id(UUID) */
export const Uuid = z.string().uuid();
export type Uuid = z.infer<typeof Uuid>;

/**
 * 시각은 ISO 8601 + 오프셋(`Z` 또는 `+09:00`)만 허용한다.
 * 활동 집계가 KST 주 경계(월요일 시작)를 쓰므로 오프셋 없는 시각은 받지 않는다.
 */
export const IsoDateTime = z.string().datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** 디스코드 사용자·서버 ID(snowflake). 봇 API 입력 검증용. */
export const DiscordSnowflake = z.string().regex(/^\d{17,20}$/, 'discord snowflake');
export type DiscordSnowflake = z.infer<typeof DiscordSnowflake>;
