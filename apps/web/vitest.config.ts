import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // @gcd/shared를 빌드 없이 소스로 읽는다(계약 2절)
    conditions: ['source'],
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Vite 6+: node 환경 테스트는 ssr 해석 규칙을 쓴다. 여기도 source를 넣어야 stale dist를 읽지 않는다
  ssr: { resolve: { conditions: ['source'], externalConditions: ['source'] } },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
