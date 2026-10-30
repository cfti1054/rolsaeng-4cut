import type { NextConfig } from 'next';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  // 워크스페이스 패키지를 TS 소스로 가져와 변환한다(빌드 산출물 불필요)
  // @gcd/core는 목 백엔드(NEXT_PUBLIC_API_MOCK)의 밸런스·ELO 계산에만 쓴다(화면 코드는 import하지 않는다)
  transpilePackages: ['@gcd/shared', '@gcd/core'],
  webpack(config) {
    // package.json exports의 "source" 조건(= src/index.ts)을 우선 사용
    config.resolve.conditionNames = ['source', ...(config.resolve.conditionNames ?? ['...'])];
    return config;
  },
  // 브라우저는 웹 오리진의 /api/v1/* 만 호출한다 → 쿠키가 1st-party, CORS 불필요.
  // 디스코드 OAuth 리다이렉트 URI도 이 경로(웹 오리진)를 쓴다.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_ORIGIN}/api/v1/:path*` }];
  },
};

export default nextConfig;
