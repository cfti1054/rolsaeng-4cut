import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Nest 데코레이터 메타데이터를 위해 SWC로 변환한다(api-contract 스킬 1절).
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    // 워크스페이스 패키지(@gcd/shared, @gcd/core)를 빌드 없이 소스로 읽는다
    conditions: ['source'],
  },
  // Vite 7에서 최상위 resolve.conditions는 client 환경에만 적용된다. vitest(node)는 ssr 환경이라
  // 여기에도 지정해야 dist(빌드 산출물, 오래됐을 수 있음) 대신 src를 읽는다.
  ssr: {
    resolve: {
      conditions: ['source'],
      externalConditions: ['source'],
    },
  },
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    environment: 'node',
    // AppModule의 JobsModule.forRoot()이 모듈을 읽을 때 cron·작업 소비자를 등록하지 않게(S1). 큐는 테스트가 목으로 바꾼다
    env: { SYNC_JOBS_ENABLED: 'false' },
    // 파일마다 첫 테스트가 Nest·Prisma 모듈을 처음 읽느라 5초를 넘길 수 있다(Windows 콜드 스타트)
    testTimeout: 30_000,
  },
});
