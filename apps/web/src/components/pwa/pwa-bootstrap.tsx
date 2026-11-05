'use client';

import { useEffect } from 'react';
import { attachInstallListeners } from '@/lib/pwa/install-store';

/**
 * PWA 부팅: 설치 프롬프트 리스너를 먼저 붙이고 서비스 워커를 등록한다.
 * 서비스 워커는 운영 빌드에서만 등록한다(개발 서버의 HMR 요청을 캐시하지 않도록).
 */
export function PwaBootstrap() {
  useEffect(() => {
    attachInstallListeners();
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // 등록 실패해도 웹은 그대로 동작한다(설치만 안 될 뿐)
    });
  }, []);
  return null;
}
