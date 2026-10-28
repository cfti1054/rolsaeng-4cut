import {
  DARK_SCHEME_QUERY,
  DEFAULT_THEME_MODE,
  THEME_STORAGE_KEY,
  parseThemeMode,
  resolveTheme,
  type ThemeMode,
} from './theme';

/**
 * 브라우저 테마 저장소. useSyncExternalStore로 구독한다.
 * - 다른 탭의 변경(storage 이벤트), 기기 설정 변경(matchMedia change)을 반영한다.
 * - 바뀔 때마다 <html data-theme>을 다시 적용한다.
 */

type Listener = () => void;
const listeners = new Set<Listener>();
/** localStorage를 못 쓰는 환경에서 이번 페이지 동안만 쓰는 값 */
let memoryMode: ThemeMode | null = null;

function readMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === null && memoryMode) return memoryMode;
    return parseThemeMode(stored);
  } catch {
    return memoryMode ?? DEFAULT_THEME_MODE;
  }
}

function readSystemDark(): boolean {
  try {
    return window.matchMedia(DARK_SCHEME_QUERY).matches;
  } catch {
    return true;
  }
}

function apply(): void {
  document.documentElement.setAttribute('data-theme', resolveTheme(readMode(), readSystemDark()));
}

function emit(): void {
  apply();
  for (const l of listeners) l();
}

export function subscribeTheme(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener('storage', onStorage);
    try {
      window.matchMedia(DARK_SCHEME_QUERY).addEventListener('change', emit);
    } catch {
      /* matchMedia 없음 */
    }
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener('storage', onStorage);
      try {
        window.matchMedia(DARK_SCHEME_QUERY).removeEventListener('change', emit);
      } catch {
        /* matchMedia 없음 */
      }
    }
  };
}

function onStorage(e: StorageEvent): void {
  if (e.key === null || e.key === THEME_STORAGE_KEY) emit();
}

/** 스냅샷은 원시값이어야 해서 "mode:systemDark" 문자열로 묶는다. */
export function getThemeSnapshot(): string {
  return `${readMode()}:${readSystemDark() ? 'dark' : 'light'}`;
}

/** 서버 렌더와 하이드레이션 첫 렌더는 기본값으로 맞춘다(실제 색은 인라인 스크립트가 이미 적용). */
export function getServerThemeSnapshot(): string {
  return `${DEFAULT_THEME_MODE}:dark`;
}

export function setThemeMode(mode: ThemeMode): void {
  memoryMode = mode;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* 저장 불가(사파리 개인 정보 보호 등): 이번 페이지에서만 적용 */
  }
  emit();
}
