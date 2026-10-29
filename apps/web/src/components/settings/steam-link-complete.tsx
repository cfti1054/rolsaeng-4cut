'use client';

import type { SteamLinkPopupMessage } from '@gcd/shared';
import { useEffect, useState } from 'react';
import { CheckIcon, AlertIcon } from '@/components/ui/icons';
import { errorMessage } from '@/lib/errors';
import { routes } from '@/lib/routes';
import {
  STEAM_POPUP_FALLBACK_DELAY_MS,
  browserChannelFactory,
  messageToSettingsQuery,
  sendSteamLinkResult,
  steamCompleteMessage,
} from '@/lib/steam-link-popup';

/**
 * 팝업 안에서 결과를 원래 창에 알리고 닫는다. API 호출은 하지 않는다(특히 /auth/refresh 금지 —
 * 원래 창과 리프레시 회전 경쟁이 생긴다). 300ms 뒤에도 열려 있으면 결과와 「설정으로 돌아가기」를 보여 준다.
 */
export function SteamLinkComplete() {
  const [msg, setMsg] = useState<SteamLinkPopupMessage | null>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const m = steamCompleteMessage(window.location.search);
    setMsg(m);
    let opener: Window | null = null;
    try {
      opener = window.opener as Window | null;
    } catch {
      opener = null;
    }
    sendSteamLinkResult(m, { createChannel: browserChannelFactory(), opener, origin: window.location.origin });
    window.close();
    const t = setTimeout(() => setStuck(true), STEAM_POPUP_FALLBACK_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  if (!msg || !stuck) {
    return (
      <main role="status" aria-live="polite" className="flex min-h-dvh items-center justify-center p-6 text-sm text-muted">
        결과를 전달하는 중이에요…
      </main>
    );
  }

  const ok = msg.status === 'linked';
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="flex w-full max-w-[420px] flex-col items-center gap-4 rounded-[22px] border border-line bg-surface p-7 text-center shadow-[inset_0_1px_0_var(--hi)]">
        <span
          aria-hidden="true"
          className={
            ok
              ? 'flex size-12 items-center justify-center rounded-[14px] bg-accent/12 text-accent-ink'
              : 'flex size-12 items-center justify-center rounded-[14px] bg-orange/12 text-orange-text'
          }
        >
          {ok ? <CheckIcon size={22} /> : <AlertIcon size={22} />}
        </span>
        <h1 className="m-0 text-lg font-bold">{ok ? '스팀 계정을 연동했어요' : '스팀 연동을 마치지 못했어요'}</h1>
        <p className="m-0 text-[13px] leading-relaxed text-muted">
          {ok ? '이 창을 닫고 원래 창으로 돌아가 주세요.' : errorMessage(msg.status === 'error' ? msg.code : 'INTERNAL_ERROR')}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => window.close()}
            className="h-10 rounded-xl border border-line-3 bg-surface-2 px-4 text-[13px] font-semibold text-text"
          >
            창 닫기
          </button>
          <a
            href={routes.settings(messageToSettingsQuery(msg))}
            className="flex h-10 items-center rounded-xl bg-accent px-4 text-[13px] font-bold text-on-accent no-underline hover:text-on-accent"
          >
            설정으로 돌아가기
          </a>
        </div>
      </div>
    </main>
  );
}
