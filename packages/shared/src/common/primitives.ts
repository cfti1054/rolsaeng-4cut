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

/**
 * S6. 달력 날짜(KST 기준 날짜, 시각 없음) `YYYY-MM-DD`. 패치노트 게시일·이벤트 시작·종료일(DB `date`).
 * 형식뿐 아니라 실제 있는 날짜인지 검사한다(2026-02-30 거부).
 */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, '존재하지 않는 날짜');
export type IsoDate = z.infer<typeof IsoDate>;

/** IsoDate 두 값의 날짜 차(b − a, 일). 형식은 호출 전에 검사돼 있어야 한다 */
export function isoDateDiffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / 86_400_000);
}

/** S6. 외부 링크(패치노트 원문·이벤트 안내). http·https만, 500자 이하. 서버는 주소를 열지 않는다(메인 기본값 1) */
export const ExternalUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((v) => /^https?:\/\//i.test(v), 'http 또는 https 주소');
export type ExternalUrl = z.infer<typeof ExternalUrl>;
