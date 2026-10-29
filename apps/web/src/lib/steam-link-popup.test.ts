import { STEAM_LINK_BROADCAST_CHANNEL, STEAM_LINK_MESSAGE_TYPE } from '@gcd/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  listenSteamLinkResult,
  messageToSettingsQuery,
  parseSteamPopupMessage,
  sendSteamLinkResult,
  steamCompleteMessage,
} from './steam-link-popup';

const LINKED = { type: STEAM_LINK_MESSAGE_TYPE, status: 'linked' } as const;
const ORIGIN = 'http://localhost:3000';

/** 같은 이름 채널끼리 메시지를 주고받는 가짜 BroadcastChannel */
function fakeChannels() {
  const open: { name: string; onmessage: ((ev: { data: unknown }) => void) | null; closed: boolean }[] = [];
  const factory = (name: string) => {
    const ch = {
      name,
      closed: false,
      onmessage: null as ((ev: { data: unknown }) => void) | null,
      postMessage(msg: unknown) {
        for (const other of open) if (other !== ch && other.name === name && !other.closed) other.onmessage?.({ data: msg });
      },
      close() {
        ch.closed = true;
      },
    };
    open.push(ch);
    return ch;
  };
  return { factory, open };
}

function fakeWindow() {
  const listeners = new Set<(ev: { data: unknown; origin: string }) => void>();
  return {
    addEventListener: (_: 'message', l: (ev: { data: unknown; origin: string }) => void) => listeners.add(l),
    removeEventListener: (_: 'message', l: (ev: { data: unknown; origin: string }) => void) => listeners.delete(l),
    dispatch: (data: unknown, origin: string) => [...listeners].forEach((l) => l({ data, origin })),
    count: () => listeners.size,
  };
}

describe('완료 페이지 메시지', () => {
  it('쿼리 → 메시지: linked / 허용 오류 코드 / 그 밖은 INTERNAL_ERROR', () => {
    expect(steamCompleteMessage('?steam=linked')).toEqual(LINKED);
    expect(steamCompleteMessage('?steam_error=STEAM_LINK_CANCELLED')).toEqual({
      type: STEAM_LINK_MESSAGE_TYPE,
      status: 'error',
      code: 'STEAM_LINK_CANCELLED',
    });
    expect(steamCompleteMessage('?steam_error=EVIL')).toMatchObject({ status: 'error', code: 'INTERNAL_ERROR' });
    expect(steamCompleteMessage('')).toMatchObject({ status: 'error', code: 'INTERNAL_ERROR' });
  });

  it('스키마 밖의 데이터는 버린다', () => {
    expect(parseSteamPopupMessage(LINKED)).toEqual(LINKED);
    expect(parseSteamPopupMessage({ ...LINKED, extra: 1 })).toBeNull();
    expect(parseSteamPopupMessage({ type: 'other', status: 'linked' })).toBeNull();
    expect(parseSteamPopupMessage('linked')).toBeNull();
  });

  it('설정 쿼리로 되돌리기', () => {
    expect(messageToSettingsQuery(LINKED)).toEqual({ steam: 'linked' });
    expect(messageToSettingsQuery({ type: STEAM_LINK_MESSAGE_TYPE, status: 'error', code: 'STEAM_OPENID_INVALID' })).toEqual({
      steam_error: 'STEAM_OPENID_INVALID',
    });
  });
});

describe('원래 창 결과 수신(첫 메시지만, origin·스키마 검사)', () => {
  it('BroadcastChannel과 postMessage가 둘 다 와도 한 번만 처리하고 리스너를 정리한다', () => {
    const ch = fakeChannels();
    const win = fakeWindow();
    const onResult = vi.fn();
    listenSteamLinkResult({ target: win, origin: ORIGIN, createChannel: ch.factory, onResult });
    expect(win.count()).toBe(1);

    const sent = sendSteamLinkResult(LINKED, {
      createChannel: ch.factory,
      opener: { postMessage: (m, o) => win.dispatch(m, o) },
      origin: ORIGIN,
    });
    expect(sent).toEqual({ channel: true, opener: true });
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(LINKED);
    expect(win.count()).toBe(0);
    expect(ch.open.every((c) => c.closed)).toBe(true);
    expect(ch.open[0]!.name).toBe(STEAM_LINK_BROADCAST_CHANNEL);
  });

  it('다른 origin의 postMessage와 형식이 틀린 메시지는 무시하고 계속 기다린다', () => {
    const win = fakeWindow();
    const onResult = vi.fn();
    listenSteamLinkResult({ target: win, origin: ORIGIN, createChannel: null, onResult });
    win.dispatch(LINKED, 'https://evil.example');
    win.dispatch({ type: STEAM_LINK_MESSAGE_TYPE, status: 'linked', x: 1 }, ORIGIN);
    expect(onResult).not.toHaveBeenCalled();
    expect(win.count()).toBe(1);
    win.dispatch(LINKED, ORIGIN);
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it('TTL이 지나면 메시지 없이 정리, 정리 함수를 부르면 이후 메시지는 무시', () => {
    const win = fakeWindow();
    const onResult = vi.fn();
    let fire: (() => void) | null = null;
    listenSteamLinkResult({
      target: win,
      origin: ORIGIN,
      createChannel: null,
      onResult,
      setTimer: (fn) => (fire = fn),
      clearTimer: () => {},
    });
    fire!();
    win.dispatch(LINKED, ORIGIN);
    expect(onResult).not.toHaveBeenCalled();

    const stop = listenSteamLinkResult({ target: win, origin: ORIGIN, createChannel: null, onResult });
    stop();
    win.dispatch(LINKED, ORIGIN);
    expect(onResult).not.toHaveBeenCalled();
  });

  it('opener가 끊겨도(COOP) BroadcastChannel만으로 전달된다', () => {
    const ch = fakeChannels();
    const win = fakeWindow();
    const onResult = vi.fn();
    listenSteamLinkResult({ target: win, origin: ORIGIN, createChannel: ch.factory, onResult });
    const sent = sendSteamLinkResult(LINKED, { createChannel: ch.factory, opener: null, origin: ORIGIN });
    expect(sent).toEqual({ channel: true, opener: false });
    expect(onResult).toHaveBeenCalledTimes(1);
  });
});
