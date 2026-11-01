'use client';

import {
  CreateEventRequest,
  CreateNoticeRequest,
  CreatePatchNoteRequest,
  EVENTS_RANGE_MAX_DAYS,
  EVENT_DESCRIPTION_MAX_LENGTH,
  EVENT_TITLE_MAX_LENGTH,
  NOTICE_BODY_MAX_LENGTH,
  NOTICE_TITLE_MAX_LENGTH,
  PAGE_LIMIT_MAX,
  PATCH_NOTE_SUMMARY_MAX_LENGTH,
  PATCH_NOTE_TITLE_MAX_LENGTH,
  PATCH_NOTE_VERSION_MAX_LENGTH,
  IsoDate,
  eventScheduleIssues,
  type EventView,
  type GameCode,
  type NoticeView,
  type PatchNoteView,
} from '@gcd/shared';
import { useState, type ReactNode } from 'react';
import { Button, ConfirmDialog, InlineError } from '@/components/ui/controls';
import { CheckboxRow, Field, PanelHead, SelectInput, TextArea, TextInput, apiErrorText } from '@/components/ui/form';
import { ChevronIcon } from '@/components/ui/icons';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { discordDeliveryText, eventScheduleIssueText } from '@/lib/admin';
import { isApiError } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { formatFull } from '@/lib/format';
import { GAME_META } from '@/lib/games';
import {
  ADMIN_PAGE_SIZE,
  useCreateEvent,
  useCreateNotice,
  useCreatePatchNote,
  useDeleteEvent,
  useDeleteNotice,
  useDeletePatchNote,
  useUpdateEvent,
  useUpdateNotice,
  useUpdatePatchNote,
} from '@/lib/hooks/admin';
import { useEvents, useNotices, usePatchNotes } from '@/lib/hooks/news';
import { useGames } from '@/lib/hooks/scrims';
import { useNow } from '@/lib/hooks/use-now';
import { addDays, eventScheduleText, isoDateDotted, kstToday } from '@/lib/news';
import type { ToastFn } from './admin-view';

const errText = (e: unknown) => (isApiError(e) ? errorMessage(e.code) : errorMessage('NETWORK_ERROR'));

/** 공지·소식 탭: NOTICE(목업 Admin) + 패치노트·이벤트(목업 없음, 같은 카드·폼 패턴) */
export function AdminNewsTab({ onToast }: { onToast: ToastFn }) {
  return (
    <>
      <NoticesCard onToast={onToast} />
      <PatchNotesCard onToast={onToast} />
      <EventsCard onToast={onToast} />
    </>
  );
}

function TwoPane({ form, list }: { form: ReactNode; list: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-5">
      <div className="flex min-w-0 flex-[2_1_320px] flex-col gap-3">{form}</div>
      <div className="flex min-w-0 flex-[3_1_420px] flex-col gap-2">{list}</div>
    </div>
  );
}

function RowShell({ title, meta, sub, onEdit, onDelete, busy }: { title: string; meta: ReactNode; sub?: ReactNode; onEdit: () => void; onDelete: () => void; busy: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3">
      <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
        <span className="break-words text-sm font-bold">{title}</span>
        <span className="text-xs text-faint">{meta}</span>
        {sub && <span className="text-xs text-muted">{sub}</span>}
      </div>
      <div className="flex gap-1.5">
        <Button size="sm" onClick={onEdit} disabled={busy}>
          수정
        </Button>
        <Button size="sm" variant="danger" onClick={onDelete} disabled={busy}>
          삭제
        </Button>
      </div>
    </li>
  );
}

/** 목적격 조사: 받침이 있으면 「을」, 없으면 「를」(공지·패치노트·이벤트 → 를, 일정 → 을) */
function objectParticle(word: string): '을' | '를' {
  const c = word.charCodeAt(word.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 ? '을' : '를';
}

/** 삭제 확인 대화상자(공지·패치노트·이벤트, 커뮤니티 캘린더도 쓴다) */
export function DeleteDialog({ what, title, open, pending, onClose, onConfirm }: { what: string; title: string; open: boolean; pending: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <ConfirmDialog
      open={open}
      title={`${what}${objectParticle(what)} 삭제할까요?`}
      description={`「${title}」을(를) 영구 삭제해요. 삭제 기록은 감사 로그에 남아요.`}
      confirmLabel="삭제"
      pending={pending}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}

// -----------------------------------------------------------------------------
// 공지
// -----------------------------------------------------------------------------

function NoticesCard({ onToast }: { onToast: ToastFn }) {
  const list = useNotices(ADMIN_PAGE_SIZE);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const now = useNow(60_000);
  const [editing, setEditing] = useState<NoticeView | null>(null);
  const [deleting, setDeleting] = useState<NoticeView | null>(null);
  const del = useDeleteNotice();
  return (
    <Card aria-labelledby="notice-title">
      <PanelHead eyebrow="NOTICE" title={editing ? '공지 수정' : '공지 작성'} id="notice-title" />
      <TwoPane
        form={<NoticeForm key={editing?.id ?? 'new'} editing={editing} onDone={() => setEditing(null)} onToast={onToast} />}
        list={
          list.isPending ? (
            <Skeleton className="h-32 rounded-2xl" />
          ) : list.isError ? (
            <ErrorState message={errText(list.error)} onRetry={() => void list.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState mark="N" title="등록된 공지가 없어요" />
          ) : (
            <>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {items.map((n) => (
                  <RowShell
                    key={n.id}
                    title={n.title}
                    meta={
                      <>
                        {n.author.nickname} · <time dateTime={n.created_at}>{formatFull(n.created_at)}</time>
                      </>
                    }
                    sub={now !== null ? discordDeliveryText(n, now) : null}
                    onEdit={() => setEditing(n)}
                    onDelete={() => setDeleting(n)}
                    busy={del.isPending}
                  />
                ))}
              </ul>
              {list.hasNextPage && (
                <Button className="self-center" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                  더 보기
                </Button>
              )}
            </>
          )
        }
      />
      <DeleteDialog
        what="공지"
        title={deleting?.title ?? ''}
        open={deleting !== null}
        pending={del.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting &&
          del.mutate(deleting.id, {
            onSuccess: () => onToast({ message: '공지를 삭제했어요.', tone: 'success' }),
            onError: (e) => onToast({ message: errText(e), tone: 'error' }),
            onSettled: () => {
              if (editing?.id === deleting.id) setEditing(null);
              setDeleting(null);
            },
          })
        }
      />
    </Card>
  );
}

function NoticeForm({ editing, onDone, onToast }: { editing: NoticeView | null; onDone: () => void; onToast: ToastFn }) {
  const [title, setTitle] = useState(editing?.title ?? '');
  const [body, setBody] = useState(editing?.body ?? '');
  const [notify, setNotify] = useState(editing?.notify_discord ?? false);
  const create = useCreateNotice();
  const update = useUpdateNotice();
  const m = editing ? update : create;
  const parsed = CreateNoticeRequest.safeParse({ title, body, notify_discord: notify });
  const notifyLocked = !!editing?.discord_notified_at;
  const submit = () => {
    if (!parsed.success) return;
    const done = (msg: string) => {
      onToast({ message: msg, tone: 'success' });
      onDone();
      if (!editing) {
        setTitle('');
        setBody('');
        setNotify(false);
      }
    };
    if (editing) update.mutate({ id: editing.id, body: { title, body, ...(notifyLocked ? {} : { notify_discord: notify }) } }, { onSuccess: () => done('공지를 수정했어요.') });
    else create.mutate({ title, body, notify_discord: notify }, { onSuccess: () => done('공지를 게시했어요.') });
  };
  return (
    <>
      <Field label="제목">
        <TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={NOTICE_TITLE_MAX_LENGTH} placeholder="예: 시즌 2 종료 안내" />
      </Field>
      <Field label="내용">
        <TextArea rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={NOTICE_BODY_MAX_LENGTH} placeholder="예: 시즌이 끝나면 최종 순위를 저장하고 상위 3명에게 뱃지를 드려요." />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <CheckboxRow checked={notify} onChange={setNotify} disabled={notifyLocked}>
          {notifyLocked ? '디스코드로 이미 보냈어요' : '디스코드에도 알림 (봇 연동 후)'}
        </CheckboxRow>
        <div className="flex gap-2">
          {editing && (
            <Button variant="ghost" onClick={onDone} disabled={m.isPending}>
              취소
            </Button>
          )}
          <Button variant="primary" onClick={submit} disabled={!parsed.success || m.isPending}>
            {m.isPending ? '저장하는 중…' : editing ? '저장' : '게시'}
          </Button>
        </div>
      </div>
      {m.isError && <InlineError>{apiErrorText(m.error)}</InlineError>}
    </>
  );
}

// -----------------------------------------------------------------------------
// 패치노트
// -----------------------------------------------------------------------------

export function useGameOptions() {
  const games = useGames();
  return (games.data?.items ?? []).map((g) => ({ code: g.code, label: GAME_META[g.code]?.short ?? g.name }));
}

function PatchNotesCard({ onToast }: { onToast: ToastFn }) {
  const list = usePatchNotes(null, ADMIN_PAGE_SIZE);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const now = useNow(60_000);
  const [editing, setEditing] = useState<PatchNoteView | null>(null);
  const [deleting, setDeleting] = useState<PatchNoteView | null>(null);
  const del = useDeletePatchNote();
  return (
    <Card aria-labelledby="patch-admin-title">
      <PanelHead eyebrow="PATCH NOTES" title={editing ? '패치노트 수정' : '패치노트 작성'} id="patch-admin-title" />
      <TwoPane
        form={now === null ? <Skeleton className="h-64 rounded-2xl" /> : <PatchForm key={editing?.id ?? 'new'} editing={editing} today={kstToday(now)} onDone={() => setEditing(null)} onToast={onToast} />}
        list={
          list.isPending ? (
            <Skeleton className="h-32 rounded-2xl" />
          ) : list.isError ? (
            <ErrorState message={errText(list.error)} onRetry={() => void list.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState mark="P" title="등록된 패치노트가 없어요" />
          ) : (
            <>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {items.map((p) => (
                  <RowShell
                    key={p.id}
                    title={`${p.version ? `${p.version} · ` : ''}${p.title}`}
                    meta={`${GAME_META[p.game.code]?.short ?? p.game.name} · ${isoDateDotted(p.published_on)} 게시`}
                    sub={now !== null ? discordDeliveryText(p, now) : null}
                    onEdit={() => setEditing(p)}
                    onDelete={() => setDeleting(p)}
                    busy={del.isPending}
                  />
                ))}
              </ul>
              {list.hasNextPage && (
                <Button className="self-center" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                  더 보기
                </Button>
              )}
            </>
          )
        }
      />
      <DeleteDialog
        what="패치노트"
        title={deleting?.title ?? ''}
        open={deleting !== null}
        pending={del.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting &&
          del.mutate(deleting.id, {
            onSuccess: () => onToast({ message: '패치노트를 삭제했어요.', tone: 'success' }),
            onError: (e) => onToast({ message: errText(e), tone: 'error' }),
            onSettled: () => {
              if (editing?.id === deleting.id) setEditing(null);
              setDeleting(null);
            },
          })
        }
      />
    </Card>
  );
}

function PatchForm({ editing, today, onDone, onToast }: { editing: PatchNoteView | null; today: string; onDone: () => void; onToast: ToastFn }) {
  const games = useGameOptions();
  const [game, setGame] = useState<GameCode | ''>(editing?.game.code ?? '');
  const [version, setVersion] = useState(editing?.version ?? '');
  const [title, setTitle] = useState(editing?.title ?? '');
  const [summary, setSummary] = useState(editing?.summary ?? '');
  const [url, setUrl] = useState(editing?.url ?? '');
  const [publishedOn, setPublishedOn] = useState(editing?.published_on ?? today);
  const [notify, setNotify] = useState(editing?.notify_discord ?? false);
  const create = useCreatePatchNote();
  const update = useUpdatePatchNote();
  const m = editing ? update : create;
  const notifyLocked = !!editing?.discord_notified_at;
  const body = { game: game || undefined, version: version.trim() ? version : null, title, summary, url: url.trim() ? url : null, published_on: publishedOn, notify_discord: notify };
  const parsed = CreatePatchNoteRequest.safeParse(body);
  const urlBad = url.trim() !== '' && !parsed.success && parsed.error.issues.some((i) => i.path[0] === 'url');
  const submit = () => {
    if (!parsed.success) return;
    const done = (msg: string) => {
      onToast({ message: msg, tone: 'success' });
      onDone();
    };
    if (editing) {
      const { notify_discord, ...rest } = parsed.data;
      update.mutate({ id: editing.id, body: notifyLocked ? rest : { ...rest, notify_discord } }, { onSuccess: () => done('패치노트를 수정했어요.') });
    } else create.mutate(parsed.data, { onSuccess: () => done('패치노트를 게시했어요.') });
  };
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="게임">
          <SelectInput value={game} onChange={(e) => setGame(e.target.value as GameCode | '')} className="h-12 w-full rounded-[14px]">
            <option value="">게임 선택</option>
            {games.map((g) => (
              <option key={g.code} value={g.code}>
                {g.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="버전(선택)">
          <TextInput value={version} onChange={(e) => setVersion(e.target.value)} maxLength={PATCH_NOTE_VERSION_MAX_LENGTH} placeholder="예: 26.21" />
        </Field>
      </div>
      <Field label="제목">
        <TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={PATCH_NOTE_TITLE_MAX_LENGTH} placeholder="예: 26.21 패치: 정글 경험치 조정" />
      </Field>
      <Field label="요약" hint="첫 줄이 홈 「패치 · 이벤트」 카드에 보여요">
        <TextArea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={PATCH_NOTE_SUMMARY_MAX_LENGTH} />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label="원문 링크(선택)" error={urlBad ? 'http 또는 https 주소를 넣어 주세요' : null}>
          <TextInput type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
        </Field>
        <Field label="게시일">
          <TextInput type="date" value={publishedOn} onChange={(e) => setPublishedOn(e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <CheckboxRow checked={notify} onChange={setNotify} disabled={notifyLocked}>
          {notifyLocked ? '알림 받기 회원에게 이미 보냈어요' : '「새 패치 요약」 알림을 켠 회원에게 디스코드 DM'}
        </CheckboxRow>
        <div className="flex gap-2">
          {editing && (
            <Button variant="ghost" onClick={onDone} disabled={m.isPending}>
              취소
            </Button>
          )}
          <Button variant="primary" onClick={submit} disabled={!parsed.success || m.isPending}>
            {m.isPending ? '저장하는 중…' : editing ? '저장' : '게시'}
          </Button>
        </div>
      </div>
      {m.isError && <InlineError>{apiErrorText(m.error)}</InlineError>}
    </>
  );
}

// -----------------------------------------------------------------------------
// 이벤트
// -----------------------------------------------------------------------------

function EventsCard({ onToast }: { onToast: ToastFn }) {
  const now = useNow(60_000);
  const [editing, setEditing] = useState<EventView | null>(null);
  const [deleting, setDeleting] = useState<EventView | null>(null);
  const del = useDeleteEvent();
  const today = now === null ? null : kstToday(now);
  return (
    <Card aria-labelledby="event-admin-title">
      <PanelHead eyebrow="EVENTS" title={editing ? '이벤트 수정' : '이벤트 등록'} id="event-admin-title" />
      {today === null ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <TwoPane
          form={<EventForm key={editing?.id ?? 'new'} editing={editing} today={today} onDone={() => setEditing(null)} onToast={onToast} />}
          list={<EventsList today={today} onEdit={setEditing} onDelete={setDeleting} busy={del.isPending} />}
        />
      )}
      <DeleteDialog
        what="이벤트"
        title={deleting?.title ?? ''}
        open={deleting !== null}
        pending={del.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting &&
          del.mutate(deleting.id, {
            onSuccess: () => onToast({ message: '이벤트를 삭제했어요.', tone: 'success' }),
            onError: (e) => onToast({ message: errText(e), tone: 'error' }),
            onSettled: () => {
              if (editing?.id === deleting.id) setEditing(null);
              setDeleting(null);
            },
          })
        }
      />
    </Card>
  );
}

/**
 * 관리 목록 구간: 처음은 오늘 기준 앞뒤(지난 이벤트 일부 + 다가오는 이벤트). 운영진 전용 목록이 없어 공개 GET /events를
 * 조회 상한(EVENTS_RANGE_MAX_DAYS) 길이 구간 단위로 이전·다음으로 옮기며 모든 기간의 이벤트를 고칠 수 있게 한다.
 */
function EventsList({ today, onEdit, onDelete, busy }: { today: string; onEdit: (e: EventView) => void; onDelete: (e: EventView) => void; busy: boolean }) {
  const [shift, setShift] = useState(0);
  const span = EVENTS_RANGE_MAX_DAYS + 1;
  const from = addDays(today, -Math.floor(EVENTS_RANGE_MAX_DAYS / 3) + shift * span);
  const to = addDays(from, EVENTS_RANGE_MAX_DAYS);
  const q = useEvents({ from, to, game: null, limit: PAGE_LIMIT_MAX });
  const nav = (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" aria-label="이전 구간" onClick={() => setShift((v) => v - 1)} className="w-9 px-0">
        <ChevronIcon dir="left" size={16} />
      </Button>
      <span className="text-xs text-faint" aria-live="polite">
        {isoDateDotted(from)} – {isoDateDotted(to)} 이벤트
      </span>
      <Button size="sm" aria-label="다음 구간" onClick={() => setShift((v) => v + 1)} className="w-9 px-0">
        <ChevronIcon dir="right" size={16} />
      </Button>
      {shift !== 0 && (
        <Button size="sm" onClick={() => setShift(0)}>
          오늘 기준
        </Button>
      )}
    </div>
  );
  if (q.isPending) return (<>{nav}<Skeleton className="h-32 rounded-2xl" /></>);
  if (q.isError) return (<>{nav}<ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} /></>);
  return (
    <>
      {nav}
      {q.data.items.length === 0 ? (
        <EmptyState mark="E" title="이 기간에 등록된 이벤트가 없어요" />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {q.data.items.map((e) => (
            <RowShell
              key={e.id}
              title={e.title}
              meta={`${e.game ? (GAME_META[e.game.code]?.short ?? e.game.name) : '게임 무관'} · ${eventScheduleText(e)}`}
              sub={e.ends_on < today ? '지난 이벤트' : null}
              onEdit={() => onEdit(e)}
              onDelete={() => onDelete(e)}
              busy={busy}
            />
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * 운영진 일정(이벤트) 작성·수정 폼. 공지·소식 탭과 커뮤니티 캘린더(admin 모드, 계약 S6 23-6)가 함께 쓴다.
 * today = 새 일정의 시작·종료일 초기값(캘린더에서는 누른 날짜).
 * onSaved가 있으면 성공 토스트를 부르는 쪽이 띄운다(캘린더 문구 「일정을 추가했어요」 등). 없으면 기존 문구.
 * 시각(23-8-5, D298): 시작·종료 시각은 선택(빈 값 = null = 종일). 시작이 비면 종료 입력을 막고 값을 비운다.
 * 검사는 서버와 같은 shared eventScheduleIssues(D300). 저장 본문은 POST·PATCH 모두 CreateEventRequest 결과 전체 —
 * start_time·end_time을 늘 함께 보내므로 PATCH 병합 규칙(start_time: null만 보내면 400)에 걸리지 않는다.
 */
export function EventForm({
  editing,
  today,
  onDone,
  onToast,
  onSaved,
}: {
  editing: EventView | null;
  today: string;
  onDone: () => void;
  onToast: ToastFn;
  onSaved?: (kind: 'create' | 'update') => void;
}) {
  const games = useGameOptions();
  const [game, setGame] = useState<GameCode | ''>(editing?.game?.code ?? '');
  const [title, setTitle] = useState(editing?.title ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [url, setUrl] = useState(editing?.url ?? '');
  const [startsOn, setStartsOn] = useState(editing?.starts_on ?? today);
  const [endsOn, setEndsOn] = useState(editing?.ends_on ?? today);
  const [startTime, setStartTimeRaw] = useState(editing?.start_time ?? '');
  const [endTime, setEndTime] = useState(editing?.end_time ?? '');
  const setStartTime = (v: string) => {
    setStartTimeRaw(v);
    if (v === '') setEndTime('');
  };
  const create = useCreateEvent();
  const update = useUpdateEvent();
  const m = editing ? update : create;
  const parsed = CreateEventRequest.safeParse({
    game: game || null,
    title,
    description: description.trim() ? description : null,
    url: url.trim() ? url : null,
    starts_on: startsOn,
    ends_on: endsOn,
    start_time: startTime || null,
    end_time: startTime ? endTime || null : null,
  });
  // 제목이 비어 parse가 일찍 끝나도 시각 규칙은 바로 보이게 같은 shared 함수로 따로 검사한다
  const datesOk = IsoDate.safeParse(startsOn).success && IsoDate.safeParse(endsOn).success;
  const timeIssue = datesOk
    ? (eventScheduleIssues({ starts_on: startsOn, ends_on: endsOn, start_time: startTime || null, end_time: startTime ? endTime || null : null }).find(
        (i) => i.path === 'end_time',
      ) ?? null)
    : null;
  const startTimeIssue = parsed.success ? null : (parsed.error.issues.find((i) => i.path[0] === 'start_time') ?? null);
  const issue = parsed.success
    ? null
    : parsed.error.issues.find((i) => i.path[0] === 'ends_on' || i.path[0] === 'url' || (i.path[0] === 'end_time' && !timeIssue));
  const submit = () => {
    if (!parsed.success) return;
    const done = (msg: string) => {
      if (onSaved) onSaved(editing ? 'update' : 'create');
      else onToast({ message: msg, tone: 'success' });
      onDone();
    };
    if (editing) update.mutate({ id: editing.id, body: parsed.data }, { onSuccess: () => done('이벤트를 수정했어요.') });
    else create.mutate(parsed.data, { onSuccess: () => done('이벤트를 등록했어요.') });
  };
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="게임">
          <SelectInput value={game} onChange={(e) => setGame(e.target.value as GameCode | '')} className="h-12 w-full rounded-[14px]">
            <option value="">게임 무관(서버 행사)</option>
            {games.map((g) => (
              <option key={g.code} value={g.code}>
                {g.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="제목">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={EVENT_TITLE_MAX_LENGTH} placeholder="예: 월즈 결승 응원 내전" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="시작일">
          <TextInput type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </Field>
        <Field label="종료일" hint="하루짜리면 시작일과 같게">
          <TextInput type="date" value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="시작 시각(선택)" hint="비우면 종일 일정이에요" error={startTimeIssue ? eventScheduleIssueText({ path: 'start_time', message: startTimeIssue.message }) : null}>
          <TextInput type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </Field>
        <Field
          label="종료 시각(선택)"
          hint={startTime ? (startsOn === endsOn ? '시작 시각 이후' : '종료일의 시각') : '시작 시각을 먼저 정해 주세요'}
          error={timeIssue ? eventScheduleIssueText(timeIssue) : null}
        >
          <TextInput
            type="time"
            value={startTime ? endTime : ''}
            min={startTime && startsOn === endsOn ? startTime : undefined}
            disabled={!startTime}
            onChange={(e) => setEndTime(e.target.value)}
            aria-invalid={timeIssue ? true : undefined}
          />
        </Field>
      </div>
      <Field label="설명(선택)" hint="첫 줄이 홈 카드에 보여요">
        <TextArea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={EVENT_DESCRIPTION_MAX_LENGTH} />
      </Field>
      <Field label="안내 링크(선택)">
        <TextInput type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
      </Field>
      {issue && (title || description || url) && <span className="text-xs text-orange-text">{eventScheduleIssueText({ path: String(issue.path[0]), message: issue.message })}</span>}
      <div className="flex justify-end gap-2">
        {editing && (
          <Button variant="ghost" onClick={onDone} disabled={m.isPending}>
            취소
          </Button>
        )}
        <Button variant="primary" onClick={submit} disabled={!parsed.success || m.isPending}>
          {m.isPending ? '저장하는 중…' : editing ? '저장' : '등록'}
        </Button>
      </div>
      {m.isError && <InlineError>{apiErrorText(m.error)}</InlineError>}
    </>
  );
}
