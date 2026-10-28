import { describe, expect, it } from 'vitest';
import {
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  parseThemeMode,
  resolveTheme,
  toggleLabel,
  toggledMode,
  type ResolvedTheme,
} from './theme';

describe('parseThemeMode', () => {
  it('저장값이 없거나 모르는 값이면 dark(기본값)', () => {
    expect(parseThemeMode(null)).toBe('dark');
    expect(parseThemeMode(undefined)).toBe('dark');
    expect(parseThemeMode('')).toBe('dark');
    expect(parseThemeMode('LIGHT')).toBe('dark');
    expect(parseThemeMode('blue')).toBe('dark');
  });
  it('light | dark | system은 그대로', () => {
    expect(parseThemeMode('light')).toBe('light');
    expect(parseThemeMode('dark')).toBe('dark');
    expect(parseThemeMode('system')).toBe('system');
  });
});

describe('resolveTheme', () => {
  it('명시값은 기기 설정과 무관', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
  it('system은 prefers-color-scheme을 따른다', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('단일 토글(모바일 헤더)', () => {
  it('해석값의 반대를 명시값으로 저장한다', () => {
    expect(toggledMode('dark')).toBe('light');
    expect(toggledMode('light')).toBe('dark');
  });
  it('레이블은 전환 후 모드를 말한다', () => {
    expect(toggleLabel('dark')).toBe('라이트 모드로 전환');
    expect(toggleLabel('light')).toBe('다크 모드로 전환');
  });
});

/** 인라인 스크립트를 가짜 window/document로 실행해 data-theme 결과를 얻는다 */
function runInitScript(env: { stored?: string | null; systemDark?: boolean; storageThrows?: boolean; noMatchMedia?: boolean }) {
  let applied: string | null = null;
  const window = {
    localStorage: {
      getItem: (k: string) => {
        if (env.storageThrows) throw new Error('SecurityError');
        return k === THEME_STORAGE_KEY ? (env.stored ?? null) : null;
      },
    },
    matchMedia: env.noMatchMedia
      ? undefined
      : (q: string) => ({ matches: q.includes('dark') ? (env.systemDark ?? true) : false }),
  };
  const document = { documentElement: { setAttribute: (_: string, v: string) => (applied = v) } };
  new Function('window', 'document', THEME_INIT_SCRIPT)(window, document);
  return applied as ResolvedTheme | null;
}

describe('THEME_INIT_SCRIPT (첫 페인트 전 적용)', () => {
  const cases: [string | null, boolean][] = [
    [null, true],
    [null, false],
    ['light', true],
    ['dark', false],
    ['system', true],
    ['system', false],
    ['garbage', false],
  ];
  it.each(cases)('저장값 %s, 기기 다크 %s → TS 구현과 같은 결과', (stored, systemDark) => {
    expect(runInitScript({ stored, systemDark })).toBe(resolveTheme(parseThemeMode(stored), systemDark));
  });
  it('localStorage 접근이 막혀도 dark로 적용하고 오류를 내지 않는다', () => {
    expect(runInitScript({ storageThrows: true, systemDark: false })).toBe('dark');
  });
  it('matchMedia가 없으면 system을 dark로 본다(목업 규칙)', () => {
    expect(runInitScript({ stored: 'system', noMatchMedia: true })).toBe('dark');
  });
});
