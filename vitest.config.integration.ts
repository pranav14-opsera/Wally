import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from './vitest.config';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['tests/integration/**/*.test.ts'],
      testTimeout: 30000,
      passWithNoTests: true,
      pool: 'forks',
      poolOptions: {
        forks: {
          singleFork: true,
        },
      },
      // The 80% threshold is enforced comprehensively by test:unit — this
      // category only exercises the handful of files touching real
      // external services (and skips entirely when those aren't
      // reachable), so grading it against the same global bar would fail
      // any run where a dependency-gated suite is conditionally skipped.
      coverage: {
        enabled: false,
      },
    },
  }),
);
