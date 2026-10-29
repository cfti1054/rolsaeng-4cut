import type { GameCode } from '@gcd/shared';

/** 마스코트 브랜드 이미지. 파일은 apps/web/public/brand 에 있다. */
export const brand = {
  avatar: '/brand/mascot-avatar.jpg',
  appIcon: '/brand/app-icon.jpg',
  loginHero: '/brand/login-hero.jpg',
  profileBanner: '/brand/profile-banner.jpg',
  homeBanner: '/brand/home-banner.jpg',
  bgNight: '/brand/bg-night.jpg',
  emptyWaiting: '/brand/mascot-cutout.png',
  loadingSleep: '/brand/loading-sleep.jpg',
  ogCard: '/brand/og-card.jpg',
  splash: '/brand/splash-mobile.jpg',
  gameBanner: {
    lol: '/brand/banner-lol.jpg',
    tft: '/brand/banner-tft.jpg',
    steam: '/brand/banner-steam.jpg',
  } satisfies Record<GameCode, string>,
} as const;
