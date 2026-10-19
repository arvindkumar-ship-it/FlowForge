import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['packages/**/*.test.ts', 'apps/server/**/*.test.ts'], coverage: { provider: 'v8', include: ['packages/core/src/**/*.ts'], exclude: ['**/*.test.ts'], thresholds: { lines: 85 } } } });
