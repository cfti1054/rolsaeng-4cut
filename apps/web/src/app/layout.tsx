import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import { brand } from '@/lib/brand';
import { THEME_INIT_SCRIPT } from '@/lib/theme/theme';
// 폰트는 @fontsource로 자체 호스팅한다(빌드·실행 모두 외부 네트워크 불필요).
// 굵기별 CSS는 unicode-range로 나뉜 조각(한글·라틴)을 담고 있어 브라우저가 쓰는 글자의 조각만 받는다.
import '@fontsource/ibm-plex-sans-kr/400.css';
import '@fontsource/ibm-plex-sans-kr/500.css';
import '@fontsource/ibm-plex-sans-kr/600.css';
import '@fontsource/ibm-plex-sans-kr/700.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import './globals.css';

export const metadata: Metadata = {
  title: { default: '롤생네컷', template: '%s · 롤생네컷' },
  description: '롤 · 롤체 · 스팀 게임방 내전과 서버 랭킹',
  icons: { icon: brand.appIcon, apple: brand.appIcon },
  openGraph: {
    title: '롤생네컷',
    description: '롤 · 롤체 · 스팀 게임방 내전과 서버 랭킹',
    images: [{ url: brand.ogCard, width: 1200, height: 675, alt: '롤생네컷 마스코트' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-theme 기본값 dark. 인라인 스크립트가 첫 페인트 전에 저장값으로 바꾸므로 suppressHydrationWarning
    <html lang="ko" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* 첫 페인트 전에 data-theme 적용 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-bg font-sans text-text">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
