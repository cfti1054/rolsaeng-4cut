import type { Metadata } from 'next';
import { SteamLinkComplete } from '@/components/settings/steam-link-complete';

export const metadata: Metadata = { title: '스팀 연동', robots: { index: false } };

/**
 * 스팀 연동 팝업 완료 페이지(S2 계약 9-2). (main)·(auth) 그룹 밖이라 인증 부팅(/auth/refresh)을 하지 않는다.
 * middleware matcher에서도 제외된다(리프레시 쿠키 검사 없음).
 */
export default function SteamLinkCompletePage() {
  return <SteamLinkComplete />;
}
