'use client';

/**
 * Android·데스크톱 Chrome 계열의 설치 프롬프트(beforeinstallprompt)와 설치 완료(appinstalled)를 잡아 둔다.
 * 이 이벤트는 페이지 로드 직후 한 번 오므로, 설정 화면이 열리기 전에 부팅 컴포넌트(PwaBootstrap)가 이 모듈을 불러
 * 리스너를 먼저 붙여야 놓치지 않는다.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

interface StoreState {
  deferred: BeforeInstallPromptEvent | null;
  installed: boolean;
}

let state: StoreState = { deferred: null, installed: false };
const listeners = new Set<() => void>();
let attached = false;

function emit(next: StoreState) {
  state = next;
  listeners.forEach((l) => l());
}

/** 전역 리스너를 한 번만 붙인다. 브라우저가 아닌 환경에서는 아무 일도 하지 않는다. */
export function attachInstallListeners(): void {
  if (attached || typeof window === 'undefined') return;
  attached = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    // 브라우저 기본 미니 인포바 대신 설정 화면의 버튼으로 띄운다
    e.preventDefault();
    emit({ ...state, deferred: e as BeforeInstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => {
    emit({ deferred: null, installed: true });
  });
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getInstallState(): StoreState {
  return state;
}

/** 설치 창을 띄운다. 사용자가 선택하면 결과를 돌려주고, 프롬프트는 한 번만 쓸 수 있어 그 뒤에는 비운다. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = state.deferred;
  if (!e) return 'unavailable';
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    emit({ ...state, deferred: null });
    return outcome;
  } catch {
    emit({ ...state, deferred: null });
    return 'unavailable';
  }
}
