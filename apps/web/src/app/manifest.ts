import type { MetadataRoute } from 'next';

/**
 * PWA 매니페스트(/manifest.webmanifest). Android Chrome 설치 조건과 설치 후 앱 이름·아이콘·표시 방식을 정한다.
 * iOS 홈 화면 아이콘은 app/apple-icon.png가 쓰이고, 이 파일의 아이콘은 Android·데스크톱용이다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: '롤생네컷',
    short_name: '롤생네컷',
    description: '롤 · 롤체 · 스팀 게임방 내전과 서버 랭킹',
    lang: 'ko',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // 다크 테마 배경(tokens.css --bg). 스플래시와 상단 바 색을 맞춘다
    background_color: '#0D1014',
    theme_color: '#0D1014',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
