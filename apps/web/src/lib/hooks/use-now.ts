'use client';

import { useEffect, useState } from 'react';

/**
 * 현재 시각(ms)을 intervalMs마다 갱신. 「N분 전」·카운트다운 표시용.
 * 첫 렌더는 null을 돌려 서버/클라이언트 렌더 차이(하이드레이션 경고)를 피한다.
 */
export function useNow(intervalMs = 30_000, enabled = true): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, enabled]);
  return now;
}
