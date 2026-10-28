import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // 워크스페이스 패키지를 빌드 없이 소스로 읽는다(package.json exports의 "source" 조건)
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
    include: ['src/**/*.test.ts'],
  },
});
