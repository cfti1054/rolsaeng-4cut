'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { getServerThemeSnapshot, getThemeSnapshot, setThemeMode, subscribeTheme } from '@/lib/theme/store';
import { parseThemeMode, resolveTheme, toggledMode, toggleLabel, type ResolvedTheme, type ThemeMode } from '@/lib/theme/theme';

export interface ThemeState {
  /** 사용자가 고른 값(light | dark | system) */
  mode: ThemeMode;
  /** 실제 적용 값 */
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  /** 해석값의 반대로 저장(모바일 헤더 토글) */
  toggle: () => void;
  toggleLabel: string;
}

export function useTheme(): ThemeState {
  const snap = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
  const [rawMode, sys] = snap.split(':');
  const mode = parseThemeMode(rawMode);
  const resolved = resolveTheme(mode, sys === 'dark');
  const toggle = useCallback(() => setThemeMode(toggledMode(resolved)), [resolved]);
  return { mode, resolved, setMode: setThemeMode, toggle, toggleLabel: toggleLabel(resolved) };
}
