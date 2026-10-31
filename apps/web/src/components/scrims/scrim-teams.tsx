'use client';

import type {
  BalanceOption,
  BalanceScrimResponse,
  EloPreview,
  PositionPreference,
  ScrimDetail,
  ScrimTeam,
} from '@gcd/shared';
import { useState } from 'react';
import { Badge, Button, InlineError } from '@/components/ui/controls';
import { EmptyState } from '@/components/ui/primitives';
import { isApiError } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { positionCode, positionLabel } from '@/lib/games';
import { useBalanceScrim, useSaveScrimTeams } from '@/lib/hooks/scrims';
import {
  PREFERENCE_LABEL,
  TEAM_LABEL,
  balanceSubtitle,
  buildTeamsRequest,
  draftFromPlayers,
  eloPreviewText,
  percent1,
  rosterKey,
  skillFormulaText,
  splitValidationDetails,
  teamPathUser,
  type TeamDraft,
} from '@/lib/scrim-results';
import { RowErrors, SectionHead, scrimErrorTextRest } from './scrim-bits';

type ToastFn = (t: { message: string; tone: 'success' | 'error' }) => void;

/** 팀 색. 레드팀(API 값 orange)은 경고색과 섞이지 않게 팀 전용 토큰을 쓴다(D174). hex 금지(D53) */
export const TEAM_TONE: Record<ScrimTeam, { border: string; bg: string; head: string; ink: string; dot: string; soft: string }> = {
  blue: { border: 'border-blue/35', bg: 'bg-blue/6', head: 'bg-blue', ink: 'text-blue-ink', dot: 'bg-blue', soft: 'bg-blue/12' },
  orange: { border: 'border-team-red/35', bg: 'bg-team-red/6', head: 'bg-team-red', ink: 'text-team-red-ink', dot: 'bg-team-red', soft: 'bg-team-red/12' },
};

/** 계약 S3 9절 오류 처리: 상태가 바뀐 경우 토스트로 알리고 상세는 훅이 다시 조회한다 */
const STALE_CODES = new Set(['SCRIM_RESULT_NOT_PENDING', 'SCRIM_TEAMS_NOT_EDITABLE', 'SCRIM_RESULT_EXISTS']);
export function isStaleError(err: unknown): boolean {
  return isApiError(err) && STALE_CODES.has(err.code);
}
export function staleToast(err: unknown, onToast: ToastFn): void {
  if (isApiError(err) && STALE_CODES.has(err.code)) onToast({ message: errorMessage(err.code), tone: 'error' });
}

// -----------------------------------------------------------------------------
// 공통 조각
// -----------------------------------------------------------------------------

interface TeamRow {
  userId: string;
  name: string;
  position: string | null;
  pref: PositionPreference | null;
  skill: number;
  isNew: boolean;
  noShow?: boolean;
}

function PrefChip({ pref }: { pref: PositionPreference | null }) {
  if (!pref) return <span />;
  return (
    <span
      className={cn(
        'rounded-md px-[7px] py-0.5 text-[11px] font-semibold',
        pref === 'first' ? 'bg-accent/10 text-accent-ink' : 'bg-orange/12 text-orange-ink-2',
      )}
    >
      {PREFERENCE_LABEL[pref]}
    </span>
  );
}

export function NewBadge() {
  return (
    <span className="rounded-[5px] bg-violet/14 px-[5px] py-px font-display text-[10px] font-bold tracking-[0.08em] text-violet-ink" title="신규 멤버(신규 K 적용)">
      NEW
    </span>
  );
}

/** 팀 카드(목업 ScrimDetail 양 팀) */
function TeamCard({
  team,
  avg,
  sum,
  preview,
  rows,
  showPositions,
}: {
  team: ScrimTeam;
  avg: number;
  sum: number;
  preview: EloPreview | null;
  rows: TeamRow[];
  showPositions: boolean;
}) {
  const tone = TEAM_TONE[team];
  const elo = eloPreviewText(preview);
  return (
    <div className={cn('min-w-0 flex-[1_1_270px] overflow-hidden rounded-[18px] border', tone.border, tone.bg)}>
      <div className={cn('flex items-center justify-between px-4 py-3 text-on-accent', tone.head)}>
        <span className="font-display text-[15px] font-bold tracking-[0.14em]">{TEAM_LABEL[team].tag}</span>
        <span className="text-xs font-semibold">
          평균 <span className="font-display text-[15px] font-bold">{avg}</span>
        </span>
      </div>
      <ul className="m-0 flex list-none flex-col px-3.5 pb-3 pt-1.5">
        {rows.map((r) => (
          <li
            key={r.userId}
            className={cn(
              'grid min-h-[42px] items-center gap-2.5 border-b border-hair',
              showPositions ? 'grid-cols-[40px_minmax(0,1fr)_auto_42px]' : 'grid-cols-[minmax(0,1fr)_auto_42px]',
              r.noShow && 'opacity-60',
            )}
          >
            {showPositions && (
              <span className={cn('font-display text-xs font-bold tracking-[0.06em]', tone.ink)} title={r.position ? positionLabel(r.position) : undefined}>
                {r.position ? positionCode(r.position) : '—'}
              </span>
            )}
            <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
              <span className="truncate">{r.name}</span>
              {r.isNew && <NewBadge />}
              {r.noShow && <Badge tone="orange">노쇼</Badge>}
            </span>
            {showPositions ? <PrefChip pref={r.pref} /> : <span />}
            <span className="text-right font-display text-sm font-semibold tabular-nums">{r.skill}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-between gap-2 px-3.5 pb-3 text-xs text-muted">
        <span>
          합계 <span className="font-display text-text">{sum}</span>
        </span>
        {elo && (
          <span>
            승리 <span className="font-display font-bold text-accent-ink">{elo.win}</span> · 패배{' '}
            <span className="font-display font-bold text-orange-ink-2">{elo.lose}</span>
          </span>
        )}
      </div>
    </div>
  );
}

/** 기대 승률 막대 + 전력 차·포지션 비용 */
function OddsBar({ blue, powerDiff, positionCost, showCost }: { blue: number; powerDiff: number; positionCost: number; showCost: boolean }) {
  const orange = 1 - blue;
  return (
    <div className="flex items-center gap-3.5 rounded-2xl bg-surface-2 px-4 py-3.5" aria-label={`블루 기대 승률 ${percent1(blue)}, 레드 기대 승률 ${percent1(orange)}`}>
      <span className="w-16 shrink-0 font-display text-lg font-bold text-blue-ink">{percent1(blue)}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div aria-hidden="true" className="flex h-2.5 gap-0.5 overflow-hidden rounded-[5px]">
          <span className="bg-blue" style={{ width: `${blue * 100}%` }} />
          <span className="flex-1 bg-team-red" />
        </div>
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted">
          <span>블루 기대 승률</span>
          <span>
            전력 차 <span className="font-display text-text">{powerDiff}</span>
            {showCost && (
              <>
                {' '}
                · 포지션 비용 <span className="font-display text-text">{positionCost}</span>
              </>
            )}
          </span>
          <span>레드 기대 승률</span>
        </div>
      </div>
      <span className="w-16 shrink-0 text-right font-display text-lg font-bold text-team-red-ink">{percent1(orange)}</span>
    </div>
  );
}

function optionRows(o: BalanceOption, team: ScrimTeam): TeamRow[] {
  return o[team].members.map((m) => ({
    userId: m.user.id,
    name: m.user.nickname,
    position: m.position,
    pref: m.preference,
    skill: m.skill,
    isNew: m.is_new,
  }));
}

function optionToDraft(o: BalanceOption, s: ScrimDetail): TeamDraft {
  const d = draftFromPlayers(s.players);
  for (const id of Object.keys(d)) d[id] = { team: null, position: null };
  for (const team of ['blue', 'orange'] as const) for (const m of o[team].members) d[m.user.id] = { team, position: m.position };
  return d;
}

// -----------------------------------------------------------------------------
// 패널
// -----------------------------------------------------------------------------

/**
 * AUTO BALANCE·팀 구성(계약 S3 9절, has_teams 게임만).
 * 밸런스 결과는 저장 전까지 화면 상태로만 두고, 명단(joined 집합)이 바뀌면 버린다.
 */
export function TeamsPanel({ s, onToast }: { s: ScrimDetail; onToast: ToastFn }) {
  const v = s.viewer;
  const balance = useBalanceScrim(s.id);
  const save = useSaveScrimTeams(s.id);
  const key = rosterKey(s.players);
  const [plan, setPlan] = useState<{ key: string; data: BalanceScrimResponse } | null>(null);
  const [pick, setPick] = useState(0);
  const [draft, setDraft] = useState<TeamDraft | null>(null);
  const current = plan && plan.key === key && v.can_edit_teams ? plan.data : null;
  const option = current ? (current.options[Math.min(pick, current.options.length - 1)] ?? null) : null;
  const editing = draft !== null && v.can_edit_teams;

  const runBalance = () =>
    balance.mutate(undefined, {
      onSuccess: (data) => {
        setPlan({ key, data });
        setPick(0);
        setDraft(null);
      },
      onError: (err) => staleToast(err, onToast),
    });

  const saveOption = (o: BalanceOption) =>
    save.mutate(
      {
        blue: o.blue.members.map((m) => ({ user_id: m.user.id, position: m.position })),
        orange: o.orange.members.map((m) => ({ user_id: m.user.id, position: m.position })),
      },
      {
        onSuccess: () => {
          setPlan(null);
          onToast({ message: `${o.rank}안으로 팀을 확정했어요.`, tone: 'success' });
        },
        onError: (err) => staleToast(err, onToast),
      },
    );

  const title = s.options.auto_balance ? '팀 자동 밸런스' : '팀 구성';
  const subtitle = current ? balanceSubtitle(current) : null;
  const err = balance.error ?? save.error;
  // 팀 저장 VALIDATION_FAILED details: 편집기에서는 해당 참가자 행 아래, 행을 찾지 못한 것만 패널 하단(계약 9절)
  const split = splitValidationDetails(isApiError(save.error) ? save.error.details : undefined, (path) =>
    editing ? teamPathUser(save.variables, path) : null,
  );
  const errText = (balance.isError || save.isError) && !isStaleError(err) ? scrimErrorTextRest(err, split.rest) : null;

  return (
    <section
      aria-labelledby="balance-title"
      className="flex flex-col gap-[18px] rounded-[20px] border border-line bg-surface p-[22px] shadow-[inset_0_1px_0_var(--hi)]"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <SectionHead eyebrow="AUTO BALANCE" title={title} id="balance-title" />
          {subtitle && !editing && <span className="text-xs text-faint">{subtitle}</span>}
        </div>
        {current && !editing && current.options.length > 1 && (
          <div role="tablist" aria-label="밸런스 안" className="flex gap-1 rounded-[14px] border border-line bg-bg p-1">
            {current.options.map((o, i) => {
              const on = option?.rank === o.rank;
              return (
                <button
                  key={o.rank}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setPick(i)}
                  className={cn(
                    'flex min-w-[72px] flex-col items-center rounded-[10px] px-3 py-1.5',
                    on ? 'bg-accent text-on-accent' : 'bg-transparent text-muted hover:text-text',
                  )}
                >
                  <span className="text-[13px] font-bold">{o.rank}안</span>
                  <span className="font-display text-[11px] opacity-80">차 {o.power_diff}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {editing && draft ? (
        <TeamEditor
          s={s}
          draft={draft}
          setDraft={setDraft}
          pending={save.isPending}
          rowErrors={save.isError ? split.byKey : {}}
          onCancel={() => setDraft(null)}
          onSave={(body) =>
            save.mutate(body, {
              onSuccess: () => {
                setDraft(null);
                setPlan(null);
                onToast({ message: '팀 구성을 저장했어요.', tone: 'success' });
              },
              onError: (e) => staleToast(e, onToast),
            })
          }
        />
      ) : option && current ? (
        <>
          <OddsBar blue={option.blue_win_probability} powerDiff={option.power_diff} positionCost={option.position_cost} showCost={current.used_positions} />
          <div className="flex flex-wrap gap-3.5">
            {(['blue', 'orange'] as const).map((team) => (
              <TeamCard
                key={team}
                team={team}
                avg={option[team].skill_avg}
                sum={option[team].skill_sum}
                preview={option[team].elo_preview}
                rows={optionRows(option, team)}
                showPositions={current.used_positions}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex-[1_1_320px] text-xs leading-relaxed text-faint">{skillFormulaText(current.rating_policy)}</span>
            {/* gap 8px: 390px에서 lg 14px 버튼 세 개(닫기·직접 수정·N안으로 팀 확정)가 한 줄에 들어가게(10px이면 0.2px 넘침) */}
            <div className="flex flex-wrap gap-2">
              <Button size="lg" variant="ghost" onClick={() => setPlan(null)} disabled={save.isPending}>
                닫기
              </Button>
              <Button size="lg" onClick={() => setDraft(optionToDraft(option, s))} disabled={save.isPending}>
                직접 수정
              </Button>
              <Button size="lg" variant="primary" onClick={() => saveOption(option)} disabled={save.isPending}>
                {save.isPending ? '저장하는 중…' : `${option.rank}안으로 팀 확정`}
              </Button>
            </div>
          </div>
        </>
      ) : s.balance ? (
        <SavedTeams s={s} />
      ) : (
        <NoTeamsYet s={s} />
      )}

      {!editing && !current && v.can_edit_teams && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex-[1_1_320px] text-xs leading-relaxed text-faint">{skillFormulaText(null)}</span>
          <div className="flex flex-wrap gap-2.5">
            <Button size="lg" onClick={() => setDraft(draftFromPlayers(s.players))} disabled={balance.isPending || save.isPending}>
              {s.balance ? '팀 다시 구성' : '팀 직접 구성'}
            </Button>
            {v.can_balance && (
              <Button size="lg" variant="primary" onClick={runBalance} disabled={balance.isPending}>
                {balance.isPending ? '계산하는 중…' : '팀 자동 밸런스 실행'}
              </Button>
            )}
          </div>
        </div>
      )}
      {errText && <InlineError>{errText}</InlineError>}
    </section>
  );
}

function NoTeamsYet({ s }: { s: ScrimDetail }) {
  const v = s.viewer;
  let description: string;
  if (s.status === 'recruiting') description = '정원이 차면 방장이 두 팀을 나눠요.';
  else if (s.status === 'finished' || s.status === 'cancelled') description = '저장된 팀 구성이 없어요.';
  else if (v.can_balance) description = '자동 밸런스를 실행하면 두 팀 전력을 맞춘 안을 최대 3개까지 보여 줘요.';
  else if (v.can_edit_teams) description = s.options.auto_balance ? '참가 인원이 맞지 않아 자동 밸런스를 쓸 수 없어요. 팀을 직접 구성해 주세요.' : '이 내전은 자동 밸런스를 쓰지 않아요. 팀을 직접 구성해 주세요.';
  else description = '방장이 팀을 나누면 여기에 보여요.';
  return <EmptyState mark="VS" title="아직 팀을 나누지 않았어요" description={description} />;
}

/** 저장된 팀 구성(ScrimDetail.balance + players.team) */
function SavedTeams({ s }: { s: ScrimDetail }) {
  const b = s.balance!;
  const usePositions = s.options.use_positions;
  const order = (p: string | null) => (p ? s.game.positions.indexOf(p) : 99);
  const rows = (team: ScrimTeam): TeamRow[] =>
    s.players
      .filter((p) => p.team === team)
      .sort((a, c) => (usePositions ? order(a.position) - order(c.position) : c.skill - a.skill || (a.user.id < c.user.id ? -1 : 1)))
      .map((p) => ({
        userId: p.user.id,
        name: p.user.nickname,
        position: p.position,
        pref: p.position_preference,
        skill: p.skill,
        isNew: p.is_new,
        noShow: p.status === 'no_show',
      }));
  const unassigned = b.unassigned_user_ids.length;
  const hasNoShow = s.players.some((p) => p.team && p.status === 'no_show');
  return (
    <>
      <OddsBar blue={b.blue_win_probability} powerDiff={b.power_diff} positionCost={b.position_cost} showCost={usePositions} />
      <div className="flex flex-wrap gap-3.5">
        {(['blue', 'orange'] as const).map((team) => (
          <TeamCard
            key={team}
            team={team}
            avg={b[team].skill_avg}
            sum={b[team].skill_sum}
            preview={b[team].elo_preview}
            rows={rows(team)}
            showPositions={usePositions}
          />
        ))}
      </div>
      {unassigned > 0 && <p className="m-0 text-[13px] text-orange-text">팀 미배정 {unassigned}명 — 레이팅에 반영되지 않아요</p>}
      {hasNoShow && <p className="m-0 text-xs text-faint">노쇼로 표시된 참가자는 팀 평균·레이팅 반영에서 빠져요.</p>}
    </>
  );
}

// -----------------------------------------------------------------------------
// 직접 수정
// -----------------------------------------------------------------------------

function TeamEditor({
  s,
  draft,
  setDraft,
  pending,
  rowErrors,
  onCancel,
  onSave,
}: {
  s: ScrimDetail;
  draft: TeamDraft;
  setDraft: (d: TeamDraft) => void;
  pending: boolean;
  rowErrors: Record<string, string[]>;
  onCancel: () => void;
  onSave: (body: NonNullable<ReturnType<typeof buildTeamsRequest>['body']>) => void;
}) {
  const usePositions = s.options.use_positions;
  const positions = s.game.positions;
  const joined = s.players.filter((p) => p.status === 'joined');
  const { body, issues } = buildTeamsRequest(s.players, draft, usePositions, positions);
  const count = (t: ScrimTeam) => Object.values(draft).filter((d) => d.team === t).length;
  const set = (userId: string, next: { team: ScrimTeam | null; position: string | null }) => setDraft({ ...draft, [userId]: next });
  const choices: { value: ScrimTeam | null; label: string }[] = [
    { value: 'blue', label: '블루' },
    { value: 'orange', label: '레드' },
    { value: null, label: '미배정' },
  ];

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[13px] text-muted">
        참가자마다 팀{usePositions ? '과 포지션' : ''}을 고르세요. 미배정인 참가자는 레이팅에 반영되지 않아요.{' '}
        <span className="font-display text-blue-ink">BLUE {count('blue')}</span> ·{' '}
        <span className="font-display text-team-red-ink">{TEAM_LABEL.orange.tag} {count('orange')}</span>
      </p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {joined.map((p) => {
          const d = draft[p.user.id] ?? { team: null, position: null };
          return (
            <li key={p.user.id} className="flex flex-wrap items-center gap-2.5 rounded-[14px] bg-surface-2 px-3 py-2">
              <span className="flex min-w-[120px] flex-1 items-center gap-1.5 text-sm font-semibold">
                {d.team && <span aria-hidden="true" className={cn('size-2 rounded-full', TEAM_TONE[d.team].dot)} />}
                <span className="truncate">{p.user.nickname}</span>
                {p.is_new && <NewBadge />}
                <span className="font-display text-xs font-semibold text-faint tabular-nums">{p.skill}</span>
              </span>
              {usePositions && p.preferred_positions.length > 0 && (
                <span className="text-xs text-faint">희망 {p.preferred_positions.map(positionLabel).join(' / ')}</span>
              )}
              <div role="radiogroup" aria-label={`${p.user.nickname} 팀`} className="flex gap-1 rounded-xl border border-line bg-bg p-1">
                {choices.map((c) => {
                  const on = d.team === c.value;
                  return (
                    <button
                      key={c.label}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={pending}
                      onClick={() => set(p.user.id, { team: c.value, position: c.value ? d.position : null })}
                      className={cn(
                        'h-8 rounded-lg px-2.5 text-xs font-semibold',
                        on ? (c.value ? cn(TEAM_TONE[c.value].head, 'text-on-accent') : 'bg-line-2 text-text') : 'text-muted hover:text-text',
                      )}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
              {usePositions && (
                <select
                  aria-label={`${p.user.nickname} 포지션`}
                  value={d.position ?? ''}
                  disabled={pending || !d.team}
                  onChange={(e) => set(p.user.id, { team: d.team, position: e.target.value || null })}
                  className="h-10 rounded-xl border border-line-3 bg-surface px-2.5 text-[13px] text-text disabled:opacity-50"
                >
                  <option value="">포지션</option>
                  {positions.map((pos) => (
                    <option key={pos} value={pos}>
                      {positionLabel(pos)}
                    </option>
                  ))}
                </select>
              )}
              <RowErrors messages={rowErrors[p.user.id]} />
            </li>
          );
        })}
      </ul>
      {issues.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-orange-text" aria-live="polite">
          {issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap justify-end gap-2.5">
        <Button size="lg" variant="ghost" onClick={onCancel} disabled={pending}>
          취소
        </Button>
        <Button size="lg" variant="primary" onClick={() => body && onSave(body)} disabled={pending || !body}>
          {pending ? '저장하는 중…' : '이 구성으로 저장'}
        </Button>
      </div>
    </div>
  );
}
