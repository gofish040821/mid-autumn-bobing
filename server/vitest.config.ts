/**
 * Vitest 配置。
 *
 * `@bobing/shared` 是一个「只有 TS 源码」的 workspace 包（main 直接指向 src/index.ts），
 * 为了让 vitest 走源码而不是去 node_modules 里找编译产物，这里显式做一次别名。
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@bobing/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 引擎测试大量使用 FakeClock，不需要真实等待
    testTimeout: 20_000,
  },
});
