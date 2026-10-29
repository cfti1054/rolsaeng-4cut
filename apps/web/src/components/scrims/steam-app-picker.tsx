'use client';

import { STEAM_APP_QUERY_MAX_LENGTH, steamAppHeaderImageUrl, type SteamAppRef } from '@gcd/shared';
import { useEffect, useId, useState } from 'react';
import { InlineError, Notice } from '@/components/ui/controls';
import { Skeleton } from '@/components/ui/primitives';
import { isApiError } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { useSteamApps } from '@/lib/hooks/scrims';

const SEARCH_DEBOUNCE_MS = 300;

/** 스팀 상점 앱 페이지 */
export function steamStoreUrl(appId: number): string {
  return `https://store.steampowered.com/app/${appId}/`;
}

/** 스팀 게임 머리 이미지(460×215 비율). CDN 이미지라 next/image 원격 설정 없이 img를 쓴다 */
export function SteamAppImage({ appId, className }: { appId: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={steamAppHeaderImageUrl(appId)}
      alt=""
      loading="lazy"
      width={460}
      height={215}
      className={cn('aspect-[460/215] shrink-0 rounded-lg bg-surface-2 object-cover', className)}
    />
  );
}

/**
 * 스팀 내전 게임 선택(D98). 검색어가 없으면 멤버들이 가진 게임, 있으면 보유 게임 + 스팀 상점 검색 결과.
 * 고르면 선택한 게임 카드로 바뀌고 「다른 게임」으로 다시 검색한다.
 */
export function SteamAppPicker({
  value,
  onChange,
  error,
}: {
  value: SteamAppRef | null;
  onChange: (v: SteamAppRef | null) => void;
  error?: string;
}) {
  const ids = { label: useId(), input: useId(), err: useId() };

  if (value) {
    return (
      <div className="flex flex-col gap-2">
        <span id={ids.label} className="text-[13px] text-muted">
          스팀 게임
        </span>
        <div className="flex items-center gap-3 rounded-2xl border-[1.5px] border-accent bg-accent/5 p-3">
          <SteamAppImage appId={value.app_id} className="w-[120px]" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="break-words text-[15px] font-bold">{value.name}</span>
            <a href={steamStoreUrl(value.app_id)} target="_blank" rel="noreferrer" className="self-start text-xs text-muted">
              스팀 상점에서 보기 ↗
            </a>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="h-9 shrink-0 rounded-[10px] border border-line-3 px-3 text-[13px] font-semibold text-text"
          >
            다른 게임
          </button>
        </div>
      </div>
    );
  }

  return <SteamAppSearch ids={ids} onPick={onChange} error={error} />;
}

function SteamAppSearch({
  ids,
  onPick,
  error,
}: {
  ids: { label: string; input: string; err: string };
  onPick: (v: SteamAppRef) => void;
  error?: string;
}) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim().replace(/\s+/g, ' ')), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);
  const apps = useSteamApps(q);
  const items = apps.data?.items ?? [];
  const searching = q !== '';

  return (
    <div className="flex flex-col gap-2">
      <label id={ids.label} htmlFor={ids.input} className="text-[13px] text-muted">
        스팀 게임 <span className="text-faint">(필수)</span>
      </label>
      <input
        id={ids.input}
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={STEAM_APP_QUERY_MAX_LENGTH}
        placeholder="게임 이름으로 검색 (예: 배틀그라운드, Lethal Company)"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? ids.err : undefined}
        aria-controls={`${ids.input}-results`}
        className="h-12 w-full min-w-0 rounded-[14px] border border-line-3 bg-bg px-4 text-[15px] text-text outline-none focus:border-accent aria-invalid:border-orange"
      />
      {error && (
        <div id={ids.err}>
          <InlineError>{error}</InlineError>
        </div>
      )}
      <span className="text-xs text-faint">
        {searching ? '멤버들이 가진 게임을 먼저, 이어서 스팀 상점 결과를 보여 줘요.' : '멤버들이 가진 게임 (보유 멤버 많은 순)'}
      </span>
      {apps.data?.store_unavailable && (
        <Notice tone="info" title="스팀 상점 검색을 지금 할 수 없어요">
          멤버들이 가진 게임 중에서만 찾았어요. 잠시 뒤 다시 검색해 주세요.
        </Notice>
      )}
      <div id={`${ids.input}-results`} aria-live="polite" aria-busy={apps.isFetching}>
        {apps.isPending ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[62px] rounded-xl" />
            ))}
          </div>
        ) : apps.isError ? (
          <InlineError>{isApiError(apps.error) ? errorMessage(apps.error.code) : errorMessage('NETWORK_ERROR')}</InlineError>
        ) : items.length === 0 ? (
          <p className="m-0 rounded-xl border border-dashed border-line-3 px-4 py-3 text-[13px] text-muted">
            {searching
              ? '검색 결과가 없어요. 다른 이름(영문 이름 등)으로 찾아 보세요.'
              : '아직 멤버들의 스팀 보유 게임 정보가 없어요. 게임 이름으로 검색해 주세요.'}
          </p>
        ) : (
          <ul aria-labelledby={ids.label} className={cn('m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2', apps.isFetching && 'opacity-60')}>
            {items.map((a) => (
              <li key={a.app_id}>
                <button
                  type="button"
                  onClick={() => onPick({ app_id: a.app_id, name: a.name })}
                  className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface-2 p-2 text-left text-text hover:border-line-3"
                >
                  <SteamAppImage appId={a.app_id} className="w-[92px]" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-semibold">{a.name}</span>
                    <span className="text-xs text-muted">{a.owner_count > 0 ? `멤버 ${a.owner_count}명 보유` : '스팀 상점'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
