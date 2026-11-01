import { z } from 'zod';
import { PaginationQuery, paginated } from './common/pagination';
import { ExternalUrl, IsoDate, IsoDateTime, Uuid, isoDateDiffDays } from './common/primitives';
import { GameCode } from './constants/games';
import { ScrimGameRef, ScrimUserRef } from './scrims';

// =============================================================================
// S6 공지·패치노트·이벤트(문서 2장 정보 「패치노트·이벤트」, 6장 GET /patch-notes·/events, 8장 /news, 목업 Admin NOTICE).
// 계약: _workspace/01_architect_contract.md(S6) 8절
//
// - 데이터는 운영진이 직접 입력한다(외부 자동 수집 없음, 메인 기본값 1). url은 외부 링크로 열 뿐 서버가 가져가지 않는다.
// - 삭제는 영구 삭제 + 감사 로그(메인 기본값 2). 소프트 삭제 없음.
// - 읽기(GET /notices·/patch-notes·/events)는 로그인한 멤버 전원(JWT). 쓰기(/admin/*)는 운영진.
// - 날짜(published_on, starts_on, ends_on)는 KST 달력 날짜 `YYYY-MM-DD`(DB date). 시각이 아니다.
// - S6 후속(D298–D305): 이벤트(운영진 일정)에 선택 시각 start_time·end_time(KST 벽시계 `HH:mm`, DB time). 없으면 종일 일정.
// =============================================================================

// -----------------------------------------------------------------------------
// 길이·한도
// -----------------------------------------------------------------------------

export const NOTICE_TITLE_MIN_LENGTH = 2;
export const NOTICE_TITLE_MAX_LENGTH = 60;
export const NOTICE_BODY_MIN_LENGTH = 1;
export const NOTICE_BODY_MAX_LENGTH = 2000;
export const PATCH_NOTE_TITLE_MIN_LENGTH = 2;
export const PATCH_NOTE_TITLE_MAX_LENGTH = 80;
export const PATCH_NOTE_VERSION_MAX_LENGTH = 20;
export const PATCH_NOTE_SUMMARY_MIN_LENGTH = 1;
export const PATCH_NOTE_SUMMARY_MAX_LENGTH = 1000;
export const EVENT_TITLE_MIN_LENGTH = 2;
export const EVENT_TITLE_MAX_LENGTH = 60;
export const EVENT_DESCRIPTION_MAX_LENGTH = 500;
/** 이벤트 하나의 최대 기간(ends_on − starts_on, 일) */
export const EVENT_SPAN_MAX_DAYS = 366;
/** GET /events 조회 구간 최대(to − from, 일). 달력 한 달 + 앞뒤 주를 넉넉히 덮는다 */
export const EVENTS_RANGE_MAX_DAYS = 92;

/** 한 줄 제목: 앞뒤 공백 제거·연속 공백 1개 */
function singleLine(min: number, max: number) {
  return z
    .string()
    .transform((v) => v.trim().replace(/\s+/g, ' '))
    .pipe(z.string().min(min).max(max));
}

/** 여러 줄 본문: 앞뒤 공백·줄 끝 공백만 정리(줄바꿈 유지), CRLF → LF */
function multiLine(min: number, max: number) {
  return z
    .string()
    .transform((v) =>
      v
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/\s+$/, ''))
        .join('\n')
        .trim(),
    )
    .pipe(z.string().min(min).max(max));
}

/** 수정 요청은 최소 한 필드가 있어야 한다 */
function atLeastOneField<T extends z.ZodRawShape>(shape: T) {
  return z
    .object(shape)
    .partial()
    .strict()
    .refine((v) => Object.values(v).some((x) => x !== undefined), { message: '바꿀 필드가 하나 이상 있어야 함' });
}

// -----------------------------------------------------------------------------
// 공지(notices)
// -----------------------------------------------------------------------------

export const NoticeTitle = singleLine(NOTICE_TITLE_MIN_LENGTH, NOTICE_TITLE_MAX_LENGTH);
export const NoticeBody = multiLine(NOTICE_BODY_MIN_LENGTH, NOTICE_BODY_MAX_LENGTH);

/**
 * 공지 1개. 목록·홈·관리자 화면 공통.
 * notify_discord: 작성자가 「디스코드에도 알림」을 켰는가. discord_notified_at: 봇이 전송을 알린 시각(전 null).
 */
export const NoticeView = z.object({
  id: Uuid,
  title: z.string(),
  body: z.string(),
  author: ScrimUserRef,
  notify_discord: z.boolean(),
  discord_notified_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
export type NoticeView = z.infer<typeof NoticeView>;

/** GET /notices — created_at DESC, id DESC. 멤버 전원 */
export const ListNoticesQuery = PaginationQuery;
export type ListNoticesQuery = z.infer<typeof ListNoticesQuery>;
export const ListNoticesResponse = paginated(NoticeView);
export type ListNoticesResponse = z.infer<typeof ListNoticesResponse>;

/** POST /admin/notices — 201 NoticeView. author = 요청한 운영진 */
export const CreateNoticeRequest = z
  .object({
    title: NoticeTitle,
    body: NoticeBody,
    notify_discord: z.boolean().default(false),
  })
  .strict();
export type CreateNoticeRequest = z.infer<typeof CreateNoticeRequest>;
export type CreateNoticeRequestInput = z.input<typeof CreateNoticeRequest>;
export const CreateNoticeResponse = NoticeView;
export type CreateNoticeResponse = z.infer<typeof CreateNoticeResponse>;

/**
 * PATCH /admin/notices/{id} — 200 NoticeView. 작성자가 아니어도 운영진이면 고칠 수 있다(author는 바뀌지 않는다).
 * notify_discord를 지금 값과 다르게 바꾸려는데 discord_notified_at이 있으면 DISCORD_ALREADY_NOTIFIED(409).
 * 전송 뒤 제목·본문을 고쳐도 다시 보내지 않는다(D257).
 */
export const UpdateNoticeRequest = atLeastOneField({
  title: NoticeTitle,
  body: NoticeBody,
  notify_discord: z.boolean(),
});
export type UpdateNoticeRequest = z.infer<typeof UpdateNoticeRequest>;
export type UpdateNoticeRequestInput = z.input<typeof UpdateNoticeRequest>;
export const UpdateNoticeResponse = NoticeView;
export type UpdateNoticeResponse = z.infer<typeof UpdateNoticeResponse>;

/** DELETE /admin/notices/{id} — 204, 영구 삭제(메인 기본값 2). 없으면 NOT_FOUND */

// -----------------------------------------------------------------------------
// 패치노트(patch_notes) — 문서 6장 GET /patch-notes
// -----------------------------------------------------------------------------

export const PatchNoteTitle = singleLine(PATCH_NOTE_TITLE_MIN_LENGTH, PATCH_NOTE_TITLE_MAX_LENGTH);
/** 게임 패치 버전 표기(예 `26.21`). 자유 형식 한 줄 */
export const PatchNoteVersion = singleLine(1, PATCH_NOTE_VERSION_MAX_LENGTH);
export const PatchNoteSummary = multiLine(PATCH_NOTE_SUMMARY_MIN_LENGTH, PATCH_NOTE_SUMMARY_MAX_LENGTH);

/**
 * 패치노트 요약 1개. url = 공식 원문 외부 링크(선택).
 * notify_discord: 「알림 받기(notify_patch)」 회원에게 디스코드 DM을 보낼지. 지난 패치를 뒤늦게 입력할 때는 끈다.
 */
export const PatchNoteView = z.object({
  id: Uuid,
  game: ScrimGameRef,
  version: z.string().nullable(),
  title: z.string(),
  summary: z.string(),
  url: z.string().url().nullable(),
  published_on: IsoDate,
  notify_discord: z.boolean(),
  discord_notified_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
export type PatchNoteView = z.infer<typeof PatchNoteView>;

/** GET /patch-notes?game= — published_on DESC, created_at DESC, id DESC. 멤버 전원 */
export const ListPatchNotesQuery = PaginationQuery.extend({
  game: GameCode.optional(),
});
export type ListPatchNotesQuery = z.infer<typeof ListPatchNotesQuery>;
export const ListPatchNotesResponse = paginated(PatchNoteView);
export type ListPatchNotesResponse = z.infer<typeof ListPatchNotesResponse>;

/** POST /admin/patch-notes — 201 PatchNoteView. game은 games.code(행이 없으면 VALIDATION_FAILED path `game`) */
export const CreatePatchNoteRequest = z
  .object({
    game: GameCode,
    version: PatchNoteVersion.nullable().default(null),
    title: PatchNoteTitle,
    summary: PatchNoteSummary,
    url: ExternalUrl.nullable().default(null),
    published_on: IsoDate,
    notify_discord: z.boolean().default(false),
  })
  .strict();
export type CreatePatchNoteRequest = z.infer<typeof CreatePatchNoteRequest>;
export type CreatePatchNoteRequestInput = z.input<typeof CreatePatchNoteRequest>;
export const CreatePatchNoteResponse = PatchNoteView;
export type CreatePatchNoteResponse = z.infer<typeof CreatePatchNoteResponse>;

/** PATCH /admin/patch-notes/{id} — 200 PatchNoteView. null은 선택 필드 비우기. notify_discord 규칙은 공지와 같다 */
export const UpdatePatchNoteRequest = atLeastOneField({
  game: GameCode,
  version: PatchNoteVersion.nullable(),
  title: PatchNoteTitle,
  summary: PatchNoteSummary,
  url: ExternalUrl.nullable(),
  published_on: IsoDate,
  notify_discord: z.boolean(),
});
export type UpdatePatchNoteRequest = z.infer<typeof UpdatePatchNoteRequest>;
export type UpdatePatchNoteRequestInput = z.input<typeof UpdatePatchNoteRequest>;
export const UpdatePatchNoteResponse = PatchNoteView;
export type UpdatePatchNoteResponse = z.infer<typeof UpdatePatchNoteResponse>;

/** DELETE /admin/patch-notes/{id} — 204, 영구 삭제 */

// -----------------------------------------------------------------------------
// 이벤트(events) — 문서 6장 GET /events, 8장 /news 이벤트 캘린더
// -----------------------------------------------------------------------------

export const EventTitle = singleLine(EVENT_TITLE_MIN_LENGTH, EVENT_TITLE_MAX_LENGTH);
export const EventDescription = multiLine(1, EVENT_DESCRIPTION_MAX_LENGTH);

/**
 * S6 후속(D299). 일정 시각 = KST 벽시계 `HH:mm`(00:00–23:59, 24:00 없음, 초 없음).
 * 시간대 변환을 하지 않는다 — 날짜(D254)와 같이 KST 값을 그대로 저장한다(DB `time(0)`, 계약 S6 8-1).
 */
export const EventTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm 형식이어야 함');
export type EventTime = z.infer<typeof EventTime>;

/**
 * 이벤트 1개(게임 출시·업데이트·서버 행사·운영진 일정). 하루짜리는 starts_on = ends_on. 기간은 양 끝 포함.
 * game null = 특정 게임과 무관한 행사.
 * S6 후속(D298–D301): start_time = starts_on 날의 시작 시각, end_time = ends_on 날의 종료 시각(KST `HH:mm`).
 *   둘 다 null = 종일. start_time만 = 시작 시각만 알림. end_time은 start_time이 있을 때만 있다.
 *   두 키는 항상 있다(값은 null 가능). D305 2단계 완료(2026-11-01): 1단계 optional → 필수.
 */
export const EventView = z.object({
  id: Uuid,
  game: ScrimGameRef.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  url: z.string().url().nullable(),
  starts_on: IsoDate,
  ends_on: IsoDate,
  start_time: EventTime.nullable(),
  end_time: EventTime.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
export type EventView = z.infer<typeof EventView>;

/**
 * GET /events?from=&to=&game= — 기간이 [from, to](양 끝 포함)와 겹치는 이벤트(starts_on ≤ to && ends_on ≥ from).
 * 정렬 starts_on ASC, start_time ASC NULLS FIRST(종일 먼저), ends_on ASC, id ASC(D302). from·to 기본값 = 오늘(KST)이 속한 달의 1일·말일(서버 계산).
 * 하나만 주면 다른 쪽은 그 달의 1일·말일. to < from 또는 to − from > EVENTS_RANGE_MAX_DAYS → VALIDATION_FAILED.
 * game을 주면 그 게임 이벤트만(game null 이벤트는 빠진다).
 */
export const ListEventsQuery = PaginationQuery.extend({
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  game: GameCode.optional(),
}).superRefine((v, ctx) => {
  if (v.from !== undefined && v.to !== undefined) {
    const d = isoDateDiffDays(v.from, v.to);
    if (d < 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'to는 from 이후' });
    else if (d > EVENTS_RANGE_MAX_DAYS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: `조회 구간은 최대 ${EVENTS_RANGE_MAX_DAYS}일` });
    }
  }
});
export type ListEventsQuery = z.infer<typeof ListEventsQuery>;
export const ListEventsResponse = paginated(EventView).extend({
  /** 실제로 적용한 조회 구간(기본값 계산 결과) */
  from: IsoDate,
  to: IsoDate,
});
export type ListEventsResponse = z.infer<typeof ListEventsResponse>;

/** 일정 기간·시각 검사 결과 1건. path는 화면·서버 오류 details의 path와 같다 */
export type EventScheduleIssue = { path: 'ends_on' | 'end_time'; message: string };

/**
 * S6 후속(D300). 저장될 값 전체(요청 + 저장값을 합친 값)를 검사한다. 문제 없으면 [].
 * - ends_on < starts_on → ends_on 「ends_on은 starts_on 이후」, 기간 > EVENT_SPAN_MAX_DAYS → ends_on. 기간 오류가 있으면 시각은 보지 않는다.
 * - end_time 있음 && start_time null → end_time 「종료 시각은 시작 시각이 있을 때만」
 * - starts_on = ends_on && 둘 다 있음 && end_time < start_time → end_time 「종료 시각은 시작 시각 이후」(같으면 허용)
 * - 여러 날 일정은 시각 순서를 보지 않는다(start_time은 첫날, end_time은 끝날 시각).
 * 쓰는 곳: CreateEventRequest(zod), 서버 PATCH 병합 검사(VALIDATION_FAILED details), 웹 폼·목.
 */
export function eventScheduleIssues(v: {
  starts_on: string;
  ends_on: string;
  start_time: string | null;
  end_time: string | null;
}): EventScheduleIssue[] {
  const d = isoDateDiffDays(v.starts_on, v.ends_on);
  if (d < 0) return [{ path: 'ends_on', message: 'ends_on은 starts_on 이후' }];
  if (d > EVENT_SPAN_MAX_DAYS) return [{ path: 'ends_on', message: `이벤트 기간은 최대 ${EVENT_SPAN_MAX_DAYS}일` }];
  if (v.end_time !== null && v.start_time === null) {
    return [{ path: 'end_time', message: '종료 시각은 시작 시각이 있을 때만' }];
  }
  if (d === 0 && v.start_time !== null && v.end_time !== null && v.end_time < v.start_time) {
    return [{ path: 'end_time', message: '종료 시각은 시작 시각 이후' }];
  }
  return [];
}

function addScheduleIssues(issues: EventScheduleIssue[], ctx: z.RefinementCtx): void {
  for (const i of issues) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i.path], message: i.message });
}

/**
 * PATCH 요청 안에서만 판단할 수 있는 것(D300). 저장값과 합친 검사는 서버가 eventScheduleIssues로 다시 한다.
 * - starts_on·ends_on 둘 다 있으면 기간 검사
 * - end_time 값 && start_time === null(명시적으로 비움) → end_time
 * - 날짜 둘 다 같고 시각 둘 다 값이면 순서 검사
 */
function checkEventPatch(
  v: { starts_on?: string; ends_on?: string; start_time?: string | null; end_time?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (v.starts_on !== undefined && v.ends_on !== undefined) {
    const span = eventScheduleIssues({ starts_on: v.starts_on, ends_on: v.ends_on, start_time: null, end_time: null });
    if (span.length > 0) return addScheduleIssues(span, ctx);
  }
  if (typeof v.end_time === 'string' && v.start_time === null) {
    return addScheduleIssues([{ path: 'end_time', message: '종료 시각은 시작 시각이 있을 때만' }], ctx);
  }
  if (
    v.starts_on !== undefined &&
    v.starts_on === v.ends_on &&
    typeof v.start_time === 'string' &&
    typeof v.end_time === 'string' &&
    v.end_time < v.start_time
  ) {
    addScheduleIssues([{ path: 'end_time', message: '종료 시각은 시작 시각 이후' }], ctx);
  }
}

/**
 * POST /admin/events — 201 EventView. ends_on 생략 = starts_on(하루). game 생략·null = 게임 무관.
 * S6 후속: start_time·end_time 생략·null = 종일(D298). 규칙은 eventScheduleIssues(D300).
 */
export const CreateEventRequest = z
  .object({
    game: GameCode.nullable().default(null),
    title: EventTitle,
    description: EventDescription.nullable().default(null),
    url: ExternalUrl.nullable().default(null),
    starts_on: IsoDate,
    ends_on: IsoDate.optional(),
    start_time: EventTime.nullable().default(null),
    end_time: EventTime.nullable().default(null),
  })
  .strict()
  .transform((v) => ({ ...v, ends_on: v.ends_on ?? v.starts_on }))
  .superRefine((v, ctx) => addScheduleIssues(eventScheduleIssues(v), ctx));
export type CreateEventRequest = z.infer<typeof CreateEventRequest>;
export type CreateEventRequestInput = z.input<typeof CreateEventRequest>;
export const CreateEventResponse = EventView;
export type CreateEventResponse = z.infer<typeof CreateEventResponse>;

/**
 * PATCH /admin/events/{id} — 200 EventView. 보낸 필드만 바꾼다(생략 = 그대로, null = 비우기).
 * start_time: null = 종일로 바꾸기(이때 저장된 end_time이 있으면 end_time: null도 함께 보내야 한다 — 아니면 VALIDATION_FAILED path end_time).
 * 서버는 저장값과 요청값을 합친 { starts_on, ends_on, start_time, end_time }을 eventScheduleIssues로 검사한다
 * (VALIDATION_FAILED details path `ends_on`·`end_time`, D300). 요청 안에서 판단할 수 있는 것은 zod가 먼저 검사한다.
 */
export const UpdateEventRequest = atLeastOneField({
  game: GameCode.nullable(),
  title: EventTitle,
  description: EventDescription.nullable(),
  url: ExternalUrl.nullable(),
  starts_on: IsoDate,
  ends_on: IsoDate,
  start_time: EventTime.nullable(),
  end_time: EventTime.nullable(),
}).superRefine(checkEventPatch);
export type UpdateEventRequest = z.infer<typeof UpdateEventRequest>;
export type UpdateEventRequestInput = z.input<typeof UpdateEventRequest>;
export const UpdateEventResponse = EventView;
export type UpdateEventResponse = z.infer<typeof UpdateEventResponse>;

/** DELETE /admin/events/{id} — 204, 영구 삭제 */

// -----------------------------------------------------------------------------
// 홈 「패치 · 이벤트」 카드 규칙(dashboard.ts DashboardNews가 쓴다)
// -----------------------------------------------------------------------------

/** 홈에 보이는 최근 패치노트 최대 수 */
export const DASHBOARD_NEWS_PATCH_NOTES_MAX = 2;
/** 홈에 보이는 진행 중·다가오는 이벤트 최대 수 */
export const DASHBOARD_NEWS_EVENTS_MAX = 2;
/** 홈 패치노트: published_on ≥ 오늘 − 이 일수 */
export const DASHBOARD_NEWS_PATCH_RECENT_DAYS = 30;
/** 홈 이벤트: ends_on ≥ 오늘 && starts_on ≤ 오늘 + 이 일수(날짜 기준 — 오늘 끝난 시각 일정도 오늘은 보인다, D303) */
export const DASHBOARD_NEWS_EVENT_AHEAD_DAYS = 30;
/** 홈 항목 subtitle 최대 글자 수(서버가 첫 줄을 이 길이로 자르고 「…」를 붙인다) */
export const DASHBOARD_NEWS_SUBTITLE_MAX = 60;
