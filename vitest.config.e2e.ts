import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from './vitest.config';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['tests/e2e/**/*.test.ts'],
      testTimeout: 30000,
      passWithNoTests: true,
      pool: 'forks',
      poolOptions: {
        forks: {
          singleFork: true,
        },
      },
      // See vitest.config.integration.ts — the 80% threshold is enforced
      // comprehensively by test:unit, not per-category.
      coverage: {
        enabled: false,
      },
    },
  }),
);
