'use client';

import {
  CreateScrimRequest,
  TFT_MODE_CAPACITY,
  TFT_MODE_LABEL,
  SCRIM_RULES_MAX_LENGTH,
  SCRIM_TITLE_MAX_LENGTH,
  ScrimTitle,
  type CreateScrimRequestInput,
  type GameView,
  type ScrimSummary,
  type TftMode,
  type SteamAppRef,
  appliedRated,
} from '@gcd/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { InlineError } from '@/components/ui/controls';
import { AlertIcon, CheckIcon } from '@/components/ui/icons';
import { ErrorState, Eyebrow, Skeleton } from '@/components/ui/primitives';
import { isApiError } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { duoBalanceNote } from '@/lib/elo-info';
import { errorMessage } from '@/lib/errors';
import { GAME_SCRIM_META } from '@/lib/games';
import { useMe } from '@/lib/hooks/auth';
import { usePositionDefaults } from '@/lib/hooks/position-defaults';
import { useCreateScrim, useGames } from '@/lib/hooks/scrims';
import { useNow } from '@/lib/hooks/use-now';
import { routes } from '@/lib/routes';
import {
  defaultScheduleInputs,
  isoToKstInputs,
  kstInputsToIso,
  scheduleMaxMs,
  scheduleMaxText,
  toPreferredPositions,
} from '@/lib/scrims';
import { PositionPicker } from './position-picker';
import { RestrictionBanner, scrimErrorText, useRestriction } from './scrim-bits';
import { ScrimCard } from './scrim-card';
import { SteamAppPicker } from './steam-app-picker';

const FIELDS = ['game', 'tft_mode', 'steam_app_id', 'title', 'scheduled_at', 'capacity', 'rules', 'host_preferred_positions'] as const;
type FieldErrors = Partial<Record<(typeof FIELDS)[number], string>>;

/** 게임 카드 설명(목업 「팀전 · 포지션 있음」「개인 순위전」) — 코드 대신 속성으로(설계 원칙 3) */
export function gameDescription(g: Pick<GameView, 'code' | 'has_teams' | 'has_positions'>): string {
  if (g.code === 'steam') return '참가 인원 모집';
  if (g.code === 'tft') return '더블업 · 일반 · 랭크';
  if (!g.has_teams) return '개인 순위전';
  return g.has_positions ? '팀전 · 포지션 있음' : '팀전';
}

/** 서버 details(snake_case path)를 필드 오류로 */
function detailsToFields(details: { path: string; message: string }[] | undefined): FieldErrors {
  const out: FieldErrors = {};
  for (const d of details ?? []) {
    const key = d.path.split('.')[0] as keyof FieldErrors;
    if ((FIELDS as readonly string[]).includes(key)) out[key] ??= d.message;
  }
  return out;
}

/**
 * /scrims/new(목업 ScrimNew, 계약 8절). 01 게임 → 02 기본 정보(+ 내 희망 포지션) → 03 진행 방식 → 04 규칙 → 미리보기.
 */
export function ScrimNewForm() {
  const router = useRouter();
  const games = useGames();
  const me = useMe();
  const create = useCreateScrim();
  const { restriction, restricted } = useRestriction();
  const now = useNow(60_000);

  const [gameCode, setGameCode] = useState<GameView['code'] | null>(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [capacity, setCapacity] = useState<number | null>(null);
  const [rules, setRules] = useState('');
  const [autoBalance, setAutoBalance] = useState(true);
  const [usePositions, setUsePositions] = useState(true);
  const [rated, setRated] = useState(true);
  const [first, setFirst] = useState<string | null>(null);
  const [second, setSecond] = useState<string | null>(null);
  const [steamApp, setSteamApp] = useState<SteamAppRef | null>(null);
  const [tftMode, setTftMode] = useState<TftMode | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  // 기본 시작 시각은 마운트 후에(서버 렌더 시각과 달라 하이드레이션이 어긋나지 않게)
  useEffect(() => {
    const d = defaultScheduleInputs(Date.now());
    setDate((v) => v || d.date);
    setTime((v) => v || d.time);
  }, []);

  const list = games.data?.items ?? [];
  const game = list.find((g) => g.code === gameCode) ?? list[0] ?? null;
  const capRange =
    game?.code === 'tft'
      ? tftMode
        ? TFT_MODE_CAPACITY[tftMode]
        : null
      : game
        ? { min: game.capacity.min, max: game.capacity.max, step: game.capacity.step, default: game.capacity.default }
        : null;
  const cap = capRange ? (capacity ?? capRange.default) : null;
  const effPositions = !!game?.has_positions && usePositions;
  const balanceChoice = game?.code === 'tft' ? tftMode === 'double_up' : !!game?.has_teams;
  const effBalance = balanceChoice && autoBalance;
  const effRated = appliedRated(game?.has_results !== false, rated);
  const needsApp = !!game?.requires_steam_app;
  const positionDefaults = usePositionDefaults({
    game: game?.code ?? null,
    enabled: !!game?.has_positions,
    eligible: effPositions,
    allowed: game?.positions ?? [],
    first,
    second,
    fill: (a, b) => {
      setFirst(a);
      setSecond(b);
    },
  });

  const pickGame = (g: GameView) => {
    setGameCode(g.code);
    setTftMode(null);
    setCapacity(g.code === 'tft' ? null : g.capacity.default);
    setFirst(null);
    setSecond(null);
    positionDefaults.reset();
    setErrors((e) => ({ ...e, game: undefined, steam_app_id: undefined, capacity: undefined, host_preferred_positions: undefined }));
  };

  const ids = { title: useId(), date: useId(), time: useId(), cap: useId(), rules: useId(), pos: useId() };
  const minDate = now ? isoToKstInputs(new Date(now).toISOString()).date : undefined;
  // 상한은 GET /me/scrim-restriction scrim_policy에서만(D101). 응답 전이면 상한 없이 서버 검사에 맡긴다
  const scrimPolicy = restriction?.scrim_policy;
  const maxMs = now ? scheduleMaxMs(now, scrimPolicy) : null;
  const maxDate = maxMs !== null ? isoToKstInputs(new Date(maxMs).toISOString()).date : undefined;
  const scheduledIso = kstInputsToIso(date, time);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!game || restricted) return;
    if (cap === null && !(game.code === 'tft' && !tftMode)) return;
    const next: FieldErrors = {};
    const t = ScrimTitle.safeParse(title);
    if (!t.success) next.title = `제목은 앞뒤 공백을 빼고 2–${SCRIM_TITLE_MAX_LENGTH}자로 써 주세요.`;
    if (!scheduledIso) next.scheduled_at = '날짜와 시작 시간을 골라 주세요.';
    else if (Date.parse(scheduledIso) <= Date.now()) next.scheduled_at = '시작 시각은 지금보다 뒤여야 해요.';
    else {
      const limit = scheduleMaxMs(Date.now(), scrimPolicy);
      if (scrimPolicy && limit !== null && Date.parse(scheduledIso) > limit) next.scheduled_at = scheduleMaxText(scrimPolicy);
    }
    if (game.code === 'tft' && !tftMode) next.tft_mode = '더블업, 일반, 랭크 중 하나를 골라 주세요.';
    if (needsApp && !steamApp) next.steam_app_id = '어떤 스팀 게임으로 내전할지 골라 주세요.';
    if (effPositions && !first) next.host_preferred_positions = '방장도 참가자예요. 1지망 포지션을 골라 주세요.';
    if (rules.length > SCRIM_RULES_MAX_LENGTH) next.rules = `규칙은 ${SCRIM_RULES_MAX_LENGTH}자까지 쓸 수 있어요.`;
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    if (cap === null) return;
    const body: CreateScrimRequestInput = {
      game: game.code,
      title,
      scheduled_at: scheduledIso!,
      capacity: cap,
      rules: rules.trim() === '' ? null : rules,
      rated: effRated,
      auto_balance: effBalance,
      use_positions: effPositions,
      ...(game.code === 'tft' && tftMode ? { tft_mode: tftMode } : {}),
      host_preferred_positions: effPositions ? toPreferredPositions(first, second) : [],
      ...(needsApp && steamApp ? { steam_app_id: steamApp.app_id } : {}),
    };
    const parsed = CreateScrimRequest.safeParse(body);
    if (!parsed.success) {
      setErrors(detailsToFields(parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))));
      return;
    }
    setErrors({});
    create.mutate(body, {
      onSuccess: (d) => router.push(routes.scrim(d.id)),
      onError: (err) => {
        if (isApiError(err) && err.code === 'VALIDATION_FAILED') setErrors(detailsToFields(err.details));
      },
    });
  };

  const preview: ScrimSummary | null =
    game && cap !== null
      ? {
          id: '00000000-0000-4000-8000-000000000000',
          game: {
            code: game.code,
            name: game.name,
            has_positions: game.has_positions,
            has_teams: game.has_teams,
            has_results: game.has_results,
            positions: game.positions,
          },
          title: title.trim().replace(/\s+/g, ' '),
          scheduled_at: scheduledIso ? new Date(scheduledIso).toISOString() : new Date(now ?? 0).toISOString(),
          capacity: cap,
          status: 'recruiting',
          host: { id: me.data?.id ?? '00000000-0000-4000-8000-000000000000', nickname: me.data?.nickname ?? '나', avatar_url: null },
          joined_count: 1,
          waitlist_count: 0,
          options: { rated: effRated, auto_balance: effBalance, use_positions: effPositions },
          steam_app: needsApp ? steamApp : null,
          open_positions: [],
          join_closed: false,
          my_status: 'joined',
          created_at: new Date(now ?? 0).toISOString(),
          result_status: null,
          outcome: null,
          tft_mode: game.code === 'tft' ? tftMode : null,
          can_delete: false,
        }
      : null;

  const submitError = create.isError && !(isApiError(create.error) && create.error.code === 'VALIDATION_FAILED');

  return (
    <>
      <header className="flex flex-col gap-1.5">
        <Link href={routes.scrims()} className="text-[13px] text-muted no-underline hover:text-text">
          ← 내전/모집 목록
        </Link>
        <Eyebrow className="mt-1 text-xs">NEW SCRIM</Eyebrow>
        <h1 className="m-0 text-[26px] font-bold tracking-[-0.03em] md:text-[30px]">내전/모집글 작성</h1>
      </header>

      <RestrictionBanner restriction={restriction} />

      {games.isError ? (
        <ErrorState
          message={isApiError(games.error) ? errorMessage(games.error.code) : errorMessage('NETWORK_ERROR')}
          onRetry={() => void games.refetch()}
        />
      ) : (
        <div className="flex flex-wrap items-start gap-[22px]">
          <form
            noValidate
            onSubmit={submit}
            aria-label="내전/모집글"
            className="flex min-w-0 flex-[2_1_540px] flex-col gap-6 rounded-[22px] border border-line bg-surface p-5 shadow-[inset_0_1px_0_var(--hi)] md:p-[26px]"
          >
            <fieldset className="m-0 min-w-0 border-0 p-0">
              <legend className="mb-3 p-0 text-sm font-bold">
                <StepNo n="01" />게임 선택
              </legend>
              {games.isPending ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-[112px] rounded-2xl" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {list.map((g) => {
                    const on = game?.code === g.code;
                    const meta = GAME_SCRIM_META[g.code];
                    return (
                      <button
                        key={g.code}
                        type="button"
                        aria-pressed={on}
                        onClick={() => pickGame(g)}
                        className={cn(
                          'relative flex min-h-[112px] flex-col gap-2.5 overflow-hidden rounded-2xl border-[1.5px] p-4 text-left text-text',
                          on ? 'border-accent bg-accent/5' : 'border-line bg-surface-2 hover:border-line-3',
                        )}
                      >
                        <span aria-hidden="true" className={cn('flex size-10 items-center justify-center rounded-xl font-display text-[13px] font-bold', meta?.tile)}>
                          {meta?.abbr ?? g.code.toUpperCase()}
                        </span>
                        <span className="flex flex-col gap-0.5">
                          <span className="text-[15px] font-bold">{meta?.label ?? g.name}</span>
                          <span className="text-xs text-muted">{gameDescription(g)}</span>
                        </span>
                        {on && (
                          <span aria-hidden="true" className="absolute right-3 top-3 flex size-[22px] items-center justify-center rounded-full bg-accent text-on-accent">
                            <CheckIcon size={12} strokeWidth={3.5} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {game?.code === 'tft' && (
                <div className="mt-4 flex flex-col gap-2">
                  <span className="text-[13px] text-muted">롤체 모드</span>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {(Object.keys(TFT_MODE_LABEL) as TftMode[]).map((mode) => {
                      const on = tftMode === mode;
                      const hint = mode === 'double_up' ? '2명씩 팀' : mode === 'ranked' ? '최대 3인 · 개인전' : '개인전';
                      return (
                        <button
                          key={mode}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            setTftMode(mode);
                            setCapacity(TFT_MODE_CAPACITY[mode].default);
                            setErrors((x) => ({ ...x, tft_mode: undefined, capacity: undefined }));
                          }}
                          className={cn(
                            'rounded-2xl border-[1.5px] px-4 py-3 text-left',
                            on ? 'border-accent bg-accent/5' : 'border-line bg-surface-2 hover:border-line-3',
                          )}
                        >
                          <span className="block text-sm font-bold">{TFT_MODE_LABEL[mode]}</span>
                          <span className="text-xs text-muted">{hint}</span>
                        </button>
                      );
                    })}
                  </div>
                  {errors.tft_mode && <InlineError>{errors.tft_mode}</InlineError>}
                </div>
              )}
              {needsApp && (
                <div className="mt-4">
                  <SteamAppPicker
                    value={steamApp}
                    error={errors.steam_app_id}
                    onChange={(v) => {
                      setSteamApp(v);
                      setErrors((x) => ({ ...x, steam_app_id: undefined }));
                    }}
                  />
                </div>
              )}
            </fieldset>

            <div className="flex flex-col gap-3.5">
              <span className="text-sm font-bold">
                <StepNo n="02" />기본 정보
              </span>
              <Field label="제목" htmlFor={ids.title} error={errors.title} hint={`${title.trim().length} / ${SCRIM_TITLE_MAX_LENGTH}`}>
                <input
                  id={ids.title}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={SCRIM_TITLE_MAX_LENGTH + 10}
                  placeholder="예: 화요일 저녁 5:5 내전"
                  aria-invalid={errors.title ? true : undefined}
                  className={inputClass}
                />
              </Field>
              <div className="flex flex-wrap gap-3.5">
                <div className="flex flex-[1_1_180px] flex-col gap-2">
                  <label htmlFor={ids.date} className="text-[13px] text-muted">
                    날짜 <span className="text-faint">(한국 시간)</span>
                  </label>
                  <input
                    id={ids.date}
                    type="date"
                    value={date}
                    min={minDate}
                    max={maxDate}
                    onChange={(e) => setDate(e.target.value)}
                    aria-invalid={errors.scheduled_at ? true : undefined}
                    className={inputClass}
                  />
                </div>
                <div className="flex flex-[1_1_140px] flex-col gap-2">
                  <label htmlFor={ids.time} className="text-[13px] text-muted">
                    시작 시간
                  </label>
                  <input
                    id={ids.time}
                    type="time"
                    step={300}
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    aria-invalid={errors.scheduled_at ? true : undefined}
                    className={cn(inputClass, 'font-display text-base font-semibold')}
                  />
                </div>
                <div className="flex flex-[1_1_170px] flex-col gap-2">
                  <span id={ids.cap} className="text-[13px] text-muted">
                    정원 <span className="text-faint">(방장 포함{capRange && capRange.step > 1 ? ` · ${capRange.step}명 단위` : ''})</span>
                  </span>
                  {capRange && cap !== null ? (
                    <CapacityStepper
                      labelledBy={ids.cap}
                      value={cap}
                      min={capRange.min}
                      max={capRange.max}
                      step={capRange.step}
                      onChange={(v) => setCapacity(v)}
                    />
                  ) : game?.code === 'tft' ? (
                    <p className="m-0 flex h-12 items-center text-sm text-muted">모드를 먼저 골라 주세요.</p>
                  ) : (
                    <Skeleton className="h-12 rounded-[14px]" />
                  )}
                </div>
              </div>
              {errors.scheduled_at && <InlineError>{errors.scheduled_at}</InlineError>}
              {errors.capacity && <InlineError>{errors.capacity}</InlineError>}

              {effPositions && game && (
                <div className="flex flex-col gap-2 rounded-2xl border border-line-2 bg-surface-2 p-4">
                  <span className="text-sm font-bold">내 희망 포지션</span>
                  <span className="text-xs text-muted">방장은 첫 참가자예요. 팀을 나눌 때 이 포지션을 먼저 고려해요.</span>
                  <PositionPicker
                    positions={game.positions}
                    first={first}
                    second={second}
                    errorId={errors.host_preferred_positions ? ids.pos : undefined}
                    onChange={(a, b) => {
                      setFirst(a);
                      setSecond(b);
                      positionDefaults.touch();
                      setErrors((x) => ({ ...x, host_preferred_positions: undefined }));
                    }}
                  />
                  {positionDefaults.hint && <p className="m-0 text-xs text-faint">{positionDefaults.hint}</p>}
                  {errors.host_preferred_positions && (
                    <div id={ids.pos}>
                      <InlineError>{errors.host_preferred_positions}</InlineError>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2.5">
              <span className="text-sm font-bold">
                <StepNo n="03" />진행 방식
              </span>
              <div className="flex flex-col gap-2">
                {balanceChoice && (
                  <Toggle
                    label="팀 자동 밸런스"
                    desc={tftMode === 'double_up' ? duoBalanceNote() : '티어와 내전/모집 레이팅으로 두 팀 전력을 맞춥니다'}
                    checked={effBalance}
                    onChange={() => setAutoBalance((v) => !v)}
                  />
                )}
                {game?.has_results === false && (
                  <p className="m-0 text-xs text-muted">인원만 모아요. 팀을 나누거나 승패를 입력하지 않아요.</p>
                )}
                <Toggle
                  label="포지션 희망 받기"
                  desc={game?.has_positions ? '참가할 때 1지망 · 2지망을 고릅니다' : '이 게임은 포지션이 없습니다'}
                  checked={effPositions}
                  disabled={!game?.has_positions}
                  onChange={() => setUsePositions((v) => !v)}
                />
                {game?.has_results !== false && (
                  <Toggle label="시즌 ELO에 반영" desc="운영진 승인 후 레이팅이 바뀝니다" checked={rated} onChange={() => setRated((v) => !v)} />
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor={ids.rules} className="text-sm font-bold">
                <StepNo n="04" />규칙 <span className="font-normal text-faint">(선택)</span>
              </label>
              <textarea
                id={ids.rules}
                rows={4}
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                maxLength={SCRIM_RULES_MAX_LENGTH}
                placeholder="예: 토너먼트 드래프트, 20:50까지 음성 채널 입장"
                aria-invalid={errors.rules ? true : undefined}
                className="resize-y rounded-[14px] border border-line-3 bg-bg px-4 py-3.5 text-sm leading-[1.7] text-text outline-none focus:border-accent"
              />
              <span className="self-end text-xs text-faint">
                {rules.length} / {SCRIM_RULES_MAX_LENGTH}
              </span>
              {errors.rules && <InlineError>{errors.rules}</InlineError>}
            </div>

            {submitError && <InlineError>{scrimErrorText(create.error, restriction)}</InlineError>}

            <div className="flex flex-wrap justify-end gap-2.5 border-t border-line pt-4">
              <Link
                href={routes.scrims()}
                className="flex h-12 items-center rounded-[14px] border border-line-3 px-5 text-sm font-semibold text-text no-underline hover:text-text"
              >
                취소
              </Link>
              <button
                type="submit"
                disabled={create.isPending || create.isSuccess || restricted || !game}
                className="h-12 rounded-[14px] bg-accent px-[26px] text-sm font-bold text-on-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {create.isPending || create.isSuccess ? '올리는 중…' : '모집 시작'}
              </button>
            </div>
          </form>

          <aside aria-label="미리보기" className="flex min-w-0 flex-[1_1_320px] flex-col gap-3">
            <Eyebrow>PREVIEW</Eyebrow>
            {preview ? <ScrimCard s={preview} now={now} preview /> : <Skeleton className="h-[330px] rounded-[20px]" />}
            <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-[13px] leading-[1.65] text-muted">
              <AlertIcon size={18} className="mt-0.5 shrink-0 text-cyan" />
              <span>
                방장은 자동으로 첫 참가자가 됩니다. 정원이 차면 <strong className="text-text">정원 마감</strong>으로 바뀌고, 이후
                신청은 대기열로 들어갑니다. 시작 시각이 지나면 참가·취소를 받지 않아요.
              </span>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

const inputClass =
  'h-12 w-full min-w-0 rounded-[14px] border border-line-3 bg-bg px-4 text-[15px] text-text outline-none focus:border-accent aria-invalid:border-orange';

function StepNo({ n }: { n: string }) {
  return <span className="mr-2 font-display text-accent-ink">{n}</span>;
}

function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[13px] text-muted">
          {label}
        </label>
        {hint && <span className="text-xs text-faint">{hint}</span>}
      </div>
      {children}
      {error && <InlineError>{error}</InlineError>}
    </div>
  );
}

export function CapacityStepper({
  labelledBy,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  labelledBy: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  if (min === max) {
    return (
      <div
        role="group"
        aria-labelledby={labelledBy}
        className="flex h-12 items-center justify-center gap-2 rounded-[14px] border border-line-3 bg-bg px-1"
      >
        <span className="font-display text-lg font-bold">{value}</span>
        <span className="text-xs text-faint">명 고정</span>
      </div>
    );
  }
  const btn =
    'size-10 rounded-[10px] border-0 bg-surface-2 text-lg text-text disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div role="group" aria-labelledby={labelledBy} className="flex h-12 items-center rounded-[14px] border border-line-3 bg-bg px-1">
      <button type="button" aria-label="정원 줄이기" className={btn} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}>
        −
      </button>
      <output aria-live="polite" className="flex-1 text-center font-display text-lg font-bold">
        {value}
      </output>
      <button type="button" aria-label="정원 늘리기" className={btn} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}>
        +
      </button>
    </div>
  );
}

export function Toggle({
  label,
  desc,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className="flex min-h-[60px] items-center justify-between gap-4 rounded-[14px] border border-line bg-surface-2 px-4 py-2 text-left text-text disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-xs text-muted">{desc}</span>
      </span>
      <span
        aria-hidden="true"
        className={cn('flex h-[26px] w-11 shrink-0 items-center rounded-full p-[3px]', checked ? 'justify-end bg-accent' : 'justify-start bg-line-3')}
      >
        <span className={cn('size-5 rounded-full', checked ? 'bg-on-accent' : 'bg-faint')} />
      </span>
    </button>
  );
}
