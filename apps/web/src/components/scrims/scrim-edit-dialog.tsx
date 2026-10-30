'use client';

import {
  SCRIM_RULES_MAX_LENGTH,
  SCRIM_TITLE_MAX_LENGTH,
  ScrimTitle,
  UpdateScrimRequest,
  type GameView,
  type ScrimDetail,
  type SteamAppRef,
} from '@gcd/shared';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button, InlineError } from '@/components/ui/controls';
import { isApiError } from '@/lib/api/client';
import { useUpdateScrim } from '@/lib/hooks/scrims';
import { buildScrimPatch, capacityFloor, isoToKstInputs, kstInputsToIso, scheduleMaxMs, scheduleMaxText } from '@/lib/scrims';
import { scrimErrorText, useRestriction } from './scrim-bits';
import { CapacityStepper, Toggle } from './scrim-new-form';
import { SteamAppPicker } from './steam-app-picker';

/** 방장 「수정」 대화상자(계약 8절: 제목·날짜·시간·정원·규칙·ELO 반영·자동 밸런스, 스팀 내전은 게임도 D98) */
export function ScrimEditDialog({
  s,
  game,
  onClose,
  onSaved,
}: {
  s: ScrimDetail;
  game: GameView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const update = useUpdateScrim(s.id);
  const scrimPolicy = useRestriction().restriction?.scrim_policy;
  const start = isoToKstInputs(s.scheduled_at);
  const [title, setTitle] = useState(s.title);
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [capacity, setCapacity] = useState(s.capacity);
  const [rules, setRules] = useState(s.rules ?? '');
  const [rated, setRated] = useState(s.options.rated);
  const [autoBalance, setAutoBalance] = useState(s.options.auto_balance);
  const [steamApp, setSteamApp] = useState<SteamAppRef | null>(s.steam_app);
  const [error, setError] = useState<string | null>(null);
  const ids = { title: useId(), date: useId(), time: useId(), cap: useId(), rules: useId(), head: useId() };

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  // 원래 시작 시각이 상한을 넘는 모집글은 그대로 둘 수 있어야 하므로 max는 상한과 현재 값 중 큰 쪽
  const limitMs = scheduleMaxMs(Date.now(), scrimPolicy);
  const maxDate = limitMs !== null ? isoToKstInputs(new Date(Math.max(limitMs, Date.parse(s.scheduled_at))).toISOString()).date : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ScrimTitle.safeParse(title).success) return setError(`제목은 2–${SCRIM_TITLE_MAX_LENGTH}자로 써 주세요.`);
    const iso = kstInputsToIso(date, time);
    if (!iso) return setError('날짜와 시작 시간을 골라 주세요.');
    if (Date.parse(iso) <= Date.now() && Date.parse(iso) !== Date.parse(s.scheduled_at)) return setError('시작 시각은 지금보다 뒤여야 해요.');
    // 상한은 scrim_policy가 있을 때만 사전 검사(D101). 없으면 서버 VALIDATION_FAILED에 맡긴다
    const limit = scheduleMaxMs(Date.now(), scrimPolicy);
    if (scrimPolicy && limit !== null && Date.parse(iso) !== Date.parse(s.scheduled_at) && Date.parse(iso) > limit) {
      return setError(scheduleMaxText(scrimPolicy));
    }
    if (capacity < s.joined_count) return setError(`지금 참가 확정이 ${s.joined_count}명이라 정원을 그보다 줄일 수 없어요.`);
    if (game.requires_steam_app && !steamApp) return setError('스팀 게임을 골라 주세요.');
    const patch = buildScrimPatch(s, {
      title,
      scheduledIso: iso,
      capacity,
      rules,
      rated,
      autoBalance: game.has_teams && autoBalance,
      steamAppId: game.requires_steam_app ? steamApp?.app_id : null,
    });
    if (!patch) return onClose();
    const parsed = UpdateScrimRequest.safeParse(patch);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? '입력값을 확인해 주세요.');
    setError(null);
    update.mutateAsync(patch).then(
      () => {
        onSaved();
        onClose();
      },
      () => {},
    );
  };

  const serverError = update.isError
    ? isApiError(update.error) && update.error.code === 'VALIDATION_FAILED' && update.error.details?.length
      ? update.error.details.map((d) => d.message).join(' · ')
      : scrimErrorText(update.error)
    : null;
  const input = 'h-11 w-full min-w-0 rounded-xl border border-line-3 bg-bg px-3.5 text-sm text-text outline-none focus:border-accent';

  return (
    <dialog
      ref={ref}
      aria-labelledby={ids.head}
      onClose={onClose}
      className="m-auto max-h-[calc(100dvh-32px)] w-[min(560px,calc(100vw-32px))] overflow-y-auto rounded-[20px] border border-line-2 bg-surface-3 p-0 text-text shadow-[0_12px_30px_var(--shadow)] backdrop:bg-shadow"
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 p-6">
        <h2 id={ids.head} className="m-0 text-lg font-bold">
          모집글 수정
        </h2>
        {game.requires_steam_app && <SteamAppPicker value={steamApp} onChange={setSteamApp} />}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.title} className="text-[13px] text-muted">
            제목
          </label>
          <input id={ids.title} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={SCRIM_TITLE_MAX_LENGTH + 10} className={input} />
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex flex-[1_1_150px] flex-col gap-1.5">
            <label htmlFor={ids.date} className="text-[13px] text-muted">
              날짜 <span className="text-faint">(한국 시간)</span>
            </label>
            <input id={ids.date} type="date" value={date} max={maxDate} onChange={(e) => setDate(e.target.value)} className={input} />
          </div>
          <div className="flex flex-[1_1_120px] flex-col gap-1.5">
            <label htmlFor={ids.time} className="text-[13px] text-muted">
              시작 시간
            </label>
            <input id={ids.time} type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} className={input} />
          </div>
          <div className="flex flex-[1_1_150px] flex-col gap-1.5">
            <span id={ids.cap} className="text-[13px] text-muted">
              정원{game.capacity.step > 1 && <span className="text-faint"> ({game.capacity.step}명 단위)</span>}
            </span>
            <CapacityStepper
              labelledBy={ids.cap}
              value={capacity}
              min={capacityFloor(game.capacity, s.joined_count)}
              max={game.capacity.max}
              step={game.capacity.step}
              onChange={setCapacity}
            />
          </div>
        </div>
        {s.join_closed && <p className="m-0 text-xs text-faint">시작 시각을 지금보다 뒤로 미루면 다시 참가·취소를 받아요.</p>}
        {capacity > s.capacity && s.waitlist_count > 0 && (
          <p className="m-0 text-xs text-faint">정원을 늘리면 대기 1번부터 순서대로 참가 확정돼요.</p>
        )}
        <div className="flex flex-col gap-2">
          <Toggle
            label="팀 자동 밸런스"
            desc={game.has_teams ? '티어와 내전 레이팅으로 두 팀 전력을 맞춥니다' : '개인전이라 사용하지 않습니다'}
            checked={game.has_teams && autoBalance}
            disabled={!game.has_teams}
            onChange={() => setAutoBalance((v) => !v)}
          />
          <Toggle label="시즌 ELO에 반영" desc="운영진 승인 후 레이팅이 바뀝니다" checked={rated} onChange={() => setRated((v) => !v)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.rules} className="text-[13px] text-muted">
            규칙
          </label>
          <textarea
            id={ids.rules}
            rows={4}
            value={rules}
            maxLength={SCRIM_RULES_MAX_LENGTH}
            onChange={(e) => setRules(e.target.value)}
            className="resize-y rounded-xl border border-line-3 bg-bg px-3.5 py-3 text-sm leading-[1.7] text-text outline-none focus:border-accent"
          />
        </div>
        {(error ?? serverError) && <InlineError>{error ?? serverError}</InlineError>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
            닫기
          </Button>
          <Button type="submit" variant="primary" disabled={update.isPending}>
            {update.isPending ? '저장하는 중…' : '저장'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
