import { z } from 'zod';
import { IsoDate, IsoDateTime, Uuid } from './common/primitives';
import { ScrimResultStatus, ScrimStatus } from './constants/enums';
import { GameCode } from './constants/games';
import { EventView } from './news';
import { MyScrimStatus, ScrimGameRef } from './scrims';
import { SteamAppRef } from './steam-apps';

// =============================================================================
// S6 후속: 커뮤니티 캘린더(사용자 요청 2026-11-01, 계약 S6 23절, D282–D297, 사용자 결정 반영 D298–D310).
// 한 달 격자에 내전/모집(scrims)과 운영진 일정(events 표)을 함께 보여 준다.
//
// - 읽기 GET /calendar 하나(로그인 회원 전원, JWT). 홈(읽기 전용)과 /admin 결과 탭(운영진이 일정 추가·수정·삭제)이 같은 응답을 쓴다.
// - 운영진 일정 쓰기는 기존 POST·PATCH·DELETE /admin/events…(news.ts)를 그대로 쓴다(새 쓰기 엔드포인트 없음, D284).
// - 내전 항목은 GET /scrims 목록 카드(ScrimSummary)에서 뽑은 공개 필드만 담는다. 참가자 명단·방장은 없다(D287).
// - 날짜는 KST 달력 날짜. 격자는 월요일 시작 7열, 그 달 1일이 든 주 월요일 ~ 말일이 든 주 일요일(최대 42일, D285).
// =============================================================================

/** 한 응답의 내전 항목 최대 수. 넘으면 scheduled_at이 이른 것부터 이 수만큼 + truncated.scrims = true(D286) */
export const CALENDAR_SCRIMS_MAX = 300;
/** 한 응답의 운영진 일정 최대 수. 넘으면 GET /events 정렬 순서(D302)로 앞에서부터 이 수만큼 + truncated.events = true(D286) */
export const CALENDAR_EVENTS_MAX = 100;

/** 'YYYY-MM'(2000-01 ~ 2099-12). KST 달 */
export const CalendarMonth = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/, 'YYYY-MM 형식이어야 함');
export type CalendarMonth = z.infer<typeof CalendarMonth>;

/**
 * GET /calendar?month=&game=
 * - month 생략 = 오늘(KST)이 속한 달(서버 계산, core resolveCalendarMonth).
 * - game 생략 = 전체. game을 주면 그 게임 내전과 그 게임 일정만(게임 무관 일정 game null은 빠진다 — GET /events와 같음, D288).
 *   games 행이 없는 코드면 items [](오류 아님, GET /scrims와 같음).
 * 페이징 없음(한 달을 한 번에 그린다). 대신 종류별 최대 수(CALENDAR_*_MAX).
 */
export const GetCalendarQuery = z.object({
  month: CalendarMonth.optional(),
  game: GameCode.optional(),
});
export type GetCalendarQuery = z.infer<typeof GetCalendarQuery>;

/** 캘린더에 나오는 내전 상태. 취소(cancelled)는 나오지 않는다(D287) */
export const CalendarScrimStatus = ScrimStatus.exclude(['cancelled']);
export type CalendarScrimStatus = z.infer<typeof CalendarScrimStatus>;

/**
 * 내전/모집 항목(읽기 전용, 누르면 /scrims/{id}). 값은 같은 요청자의 GET /scrims 목록 카드(ScrimSummary)와 같다.
 * date = scheduled_at의 KST 날짜(core kstDateKey). 화면 상태 배지는 scrimCardBadge(status, join_closed, my_status, result_status) 그대로.
 */
export const CalendarScrimItem = z.object({
  kind: z.literal('scrim'),
  id: Uuid,
  title: z.string(),
  game: ScrimGameRef,
  /** 스팀 내전에서 고른 게임(ScrimSummary.steam_app과 같음) */
  steam_app: SteamAppRef.nullable(),
  /** 기타 모집 게임 이름(ScrimSummary.custom_game_name과 같음). 생략하면 null */
  custom_game_name: z.string().min(1).max(40).nullable().default(null),
  date: IsoDate,
  scheduled_at: IsoDateTime,
  status: CalendarScrimStatus,
  capacity: z.number().int().min(1),
  /** ScrimSummary.joined_count와 같음(시작 후 joined + no_show) */
  joined_count: z.number().int().min(0),
  join_closed: z.boolean(),
  /** 요청자 본인의 참가 상태(남의 상태는 없다) */
  my_status: MyScrimStatus.nullable(),
  result_status: ScrimResultStatus.nullable(),
});
export type CalendarScrimItem = z.infer<typeof CalendarScrimItem>;

/**
 * 운영진 일정 항목 = events 표 1행(EventView 그대로 + kind). 관리자 캘린더의 수정 폼이 이 값을 그대로 채운다(D289).
 * 여러 날 일정은 starts_on ~ ends_on(양 끝 포함). S6 후속(D298): 선택 시각 start_time(첫날)·end_time(끝날), 둘 다 null이면 종일
 * (D283 「날짜만」은 D298로 대체).
 */
export const CalendarEventItem = EventView.extend({
  kind: z.literal('event'),
});
export type CalendarEventItem = z.infer<typeof CalendarEventItem>;

export const CalendarItem = z.discriminatedUnion('kind', [CalendarScrimItem, CalendarEventItem]);
export type CalendarItem = z.infer<typeof CalendarItem>;

/**
 * GET /calendar 응답.
 * - from·to = 격자 첫날·끝날(월요일 ~ 일요일, KST). 이 구간과 겹치는 일정, scheduled_at이 [from 00:00 KST, to+1 00:00 KST)인 내전.
 * - items 순서(D290): 운영진 일정 전부(starts_on ASC, start_time ASC NULLS FIRST, ends_on ASC, id ASC — GET /events와 같음, D302) 다음 내전 전부(scheduled_at ASC, id ASC).
 * - truncated: 종류별로 최대 수를 넘어 잘렸는가. 화면은 「일부만 보여요」 안내 + 내전 목록 링크.
 */
export const GetCalendarResponse = z.object({
  month: CalendarMonth,
  from: IsoDate,
  to: IsoDate,
  items: z.array(CalendarItem),
  truncated: z.object({
    scrims: z.boolean(),
    events: z.boolean(),
  }),
});
export type GetCalendarResponse = z.infer<typeof GetCalendarResponse>;
