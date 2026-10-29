import {
  STEAM_LINK_BROADCAST_CHANNEL,
  STEAM_LINK_MESSAGE_TYPE,
  STEAM_LINK_STATE_TTL_SEC,
  SteamLinkCompletePageQuery,
  SteamLinkPopupMessage,
  type SettingsPageQuery,
} from '@gcd/shared';

/**
 * 스팀 연동 팝업(S2 계약 9-2, D74). 순수 로직만 두고 DOM 객체는 인자로 받는다(단위 테스트 대상).
 * - 원래 창: window.open(사용자 동작 안에서 동기적으로) → 결과는 BroadcastChannel + window message 둘 다 듣고 첫 메시지만 처리
 * - 완료 페이지: 같은 메시지를 두 경로로 보내고 창을 닫는다
 */

export const STEAM_POPUP_WINDOW_NAME = 'gcd-steam-link';
export const STEAM_POPUP_FEATURES = 'popup,width=520,height=720';
/** 완료 페이지가 스스로 닫히지 않았을 때 안내를 보여 주기까지(계약 9-2) */
export const STEAM_POPUP_FALLBACK_DELAY_MS = 300;
/** 팝업 닫힘 감시 간격 */
export const STEAM_POPUP_CLOSED_POLL_MS = 1_000;
/** BroadcastChannel 리스너 유지 시간 = state 쿠키 수명(스팀 페이지 COOP로 popup.closed가 일찍 true가 될 수 있어서) */
export const STEAM_POPUP_LISTEN_TTL_MS = STEAM_LINK_STATE_TTL_SEC * 1000;

/** 완료 페이지 쿼리 → 원래 창에 보낼 메시지. 파싱 실패·빈 쿼리는 INTERNAL_ERROR(계약 9-2) */
export function steamCompleteMessage(search: string | URLSearchParams): SteamLinkPopupMessage {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const raw: Record<string, string> = {};
  for (const key of ['steam', 'steam_error'] as const) {
    const v = params.get(key);
    if (v !== null) raw[key] = v;
  }
  const parsed = SteamLinkCompletePageQuery.safeParse(raw);
  if (parsed.success && parsed.data.steam_error) {
    return { type: STEAM_LINK_MESSAGE_TYPE, status: 'error', code: parsed.data.steam_error };
  }
  if (parsed.success && parsed.data.steam === 'linked') return { type: STEAM_LINK_MESSAGE_TYPE, status: 'linked' };
  return { type: STEAM_LINK_MESSAGE_TYPE, status: 'error', code: 'INTERNAL_ERROR' };
}

/** 받은 데이터가 계약 메시지일 때만 값, 아니면 null */
export function parseSteamPopupMessage(data: unknown): SteamLinkPopupMessage | null {
  const parsed = SteamLinkPopupMessage.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** 메시지 → 설정 화면 쿼리(완료 페이지의 「설정으로 돌아가기」 링크와 토스트가 같은 흐름을 쓰게) */
export function messageToSettingsQuery(msg: SteamLinkPopupMessage): SettingsPageQuery {
  return msg.status === 'linked' ? { steam: 'linked' } : { steam_error: msg.code };
}

interface ChannelLike {
  postMessage(msg: unknown): void;
  close(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}
type ChannelFactory = (name: string) => ChannelLike;

interface MessageTarget {
  addEventListener(type: 'message', listener: (ev: { data: unknown; origin: string }) => void): void;
  removeEventListener(type: 'message', listener: (ev: { data: unknown; origin: string }) => void): void;
}

/** 브라우저의 BroadcastChannel(없으면 null — 구형 Safari) */
export function browserChannelFactory(): ChannelFactory | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  return (name) => new BroadcastChannel(name) as unknown as ChannelLike;
}

export interface ListenOptions {
  /** window message 이벤트 대상(원래 창의 window) */
  target: MessageTarget;
  /** 원래 창의 origin. postMessage는 이 origin에서 온 것만 받는다 */
  origin: string;
  createChannel: ChannelFactory | null;
  onResult: (msg: SteamLinkPopupMessage) => void;
  ttlMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

/**
 * 결과 수신 등록. 두 경로 중 **첫 유효 메시지 하나만** onResult로 넘기고 모든 리스너를 정리한다.
 * ttl이 지나면 메시지 없이 정리. 반환값을 부르면 즉시 정리(새 시도·언마운트).
 */
export function listenSteamLinkResult(o: ListenOptions): () => void {
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let done = false;
  let channel: ChannelLike | null = null;

  const cleanup = () => {
    if (done) return;
    done = true;
    o.target.removeEventListener('message', onWindowMessage);
    if (channel) {
      channel.onmessage = null;
      channel.close();
    }
    clearTimer(timer);
  };
  const deliver = (data: unknown) => {
    if (done) return;
    const msg = parseSteamPopupMessage(data);
    if (!msg) return;
    cleanup();
    o.onResult(msg);
  };
  function onWindowMessage(ev: { data: unknown; origin: string }) {
    if (ev.origin !== o.origin) return;
    deliver(ev.data);
  }

  o.target.addEventListener('message', onWindowMessage);
  if (o.createChannel) {
    try {
      channel = o.createChannel(STEAM_LINK_BROADCAST_CHANNEL);
      channel.onmessage = (ev) => deliver(ev.data);
    } catch {
      channel = null;
    }
  }
  const timer = setTimer(cleanup, o.ttlMs ?? STEAM_POPUP_LISTEN_TTL_MS);
  return cleanup;
}

/** 완료 페이지: 같은 메시지를 BroadcastChannel(지원 시)과 opener.postMessage(targetOrigin = 자기 origin)로 보낸다 */
export function sendSteamLinkResult(
  msg: SteamLinkPopupMessage,
  env: {
    createChannel: ChannelFactory | null;
    opener: { postMessage(msg: unknown, targetOrigin: string): void } | null;
    origin: string;
  },
): { channel: boolean; opener: boolean } {
  const sent = { channel: false, opener: false };
  if (env.createChannel) {
    try {
      const ch = env.createChannel(STEAM_LINK_BROADCAST_CHANNEL);
      ch.postMessage(msg);
      ch.close();
      sent.channel = true;
    } catch {
      /* 채널 실패는 opener 경로로 대신한다 */
    }
  }
  if (env.opener) {
    try {
      env.opener.postMessage(msg, env.origin);
      sent.opener = true;
    } catch {
      /* COOP 등으로 opener가 끊긴 경우 */
    }
  }
  return sent;
}
