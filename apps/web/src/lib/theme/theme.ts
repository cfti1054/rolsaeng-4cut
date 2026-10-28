/**
 * 테마 결정 로직(계약 9-4, 목업 themeVals()와 같은 규칙). DOM에 의존하지 않는 순수 함수만 둔다.
 * - 저장: localStorage['gcd-theme'] = light | dark | system (서버 저장 안 함)
 * - 기본값: 저장값이 없거나 알 수 없는 값이면 dark
 * - system: prefers-color-scheme을 따른다
 */

export const THEME_STORAGE_KEY = 'gcd-theme';
export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
export type ResolvedTheme = 'light' | 'dark';

export const DEFAULT_THEME_MODE: ThemeMode = 'dark';
export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

export function parseThemeMode(raw: string | null | undefined): ThemeMode {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : DEFAULT_THEME_MODE;
}

export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light';
  return mode;
}

/** 모바일 헤더·로그인 화면의 단일 토글: 현재 해석값의 반대를 명시값으로 저장한다. */
export function toggledMode(resolved: ResolvedTheme): ThemeMode {
  return resolved === 'dark' ? 'light' : 'dark';
}

export function toggleLabel(resolved: ResolvedTheme): string {
  return resolved === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환';
}

/**
 * <head>에 넣는 인라인 스크립트. React가 뜨기 전, 첫 페인트 전에 <html data-theme>을 정한다.
 * 위 함수들과 같은 규칙을 ES5로 다시 쓴 것이라 theme.test.ts에서 두 구현이 같은 결과를 내는지 검사한다.
 * matchMedia를 못 쓰면 목업처럼 다크로 본다.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var m=null;try{m=window.localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})}catch(e){}if(m!=='light'&&m!=='dark'&&m!=='system')m=${JSON.stringify(
  DEFAULT_THEME_MODE,
)};var d=true;try{d=window.matchMedia(${JSON.stringify(
  DARK_SCHEME_QUERY,
)}).matches}catch(e){}var r=m==='system'?(d?'dark':'light'):m;document.documentElement.setAttribute('data-theme',r)}catch(e){}})();`;
