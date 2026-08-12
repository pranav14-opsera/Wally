import { z } from 'zod';

import type { AppConfig } from '../../config/index.js';

/**
 * A factory, not a static schema object — every bound comes from
 * `AppConfig` (env-var-backed) rather than a literal in this file, per
 * the zero-hardcoding policy enforced on `src/agents/**` (RULES.md).
 */
export function createLoadTestThresholdsSchema(config: AppConfig) {
  return z.object({
    p95LatencyMs: z.coerce.number().positive().default(config.LOADTEST_DEFAULT_P95_THRESHOLD_MS).describe('Max acceptable p95 latency in ms'),
    // eslint-disable-next-line wally/no-hardcoded-config -- 100 here is the mathematical upper bound of a percentage, not a configurable business threshold
    errorRatePct: z.coerce.number().min(0).max(100).default(config.LOADTEST_DEFAULT_ERROR_RATE_PCT).describe('Max acceptable error rate percentage'),
  });
}

export function createLoadTestProfileSchema(config: AppConfig) {
  const thresholdsSchema = createLoadTestThresholdsSchema(config);
  return z.object({
    name: z.string().min(1).max(config.LOADTEST_NAME_MAX_LENGTH).describe('Human-readable name for this load test profile'),
    targetUrl: z.string().url().describe('URL k6 will send requests to'),
    vus: z.coerce.number().int().positive().max(config.LOADTEST_MAX_VUS).default(config.LOADTEST_DEFAULT_VUS).describe('Number of virtual users'),
    durationSeconds: z.coerce
      .number()
      .int()
      .positive()
      .max(config.LOADTEST_MAX_DURATION_SECONDS)
      .default(config.LOADTEST_DEFAULT_DURATION_SECONDS)
      .describe('Test duration in seconds'),
    thresholds: thresholdsSchema.default({
      p95LatencyMs: config.LOADTEST_DEFAULT_P95_THRESHOLD_MS,
      errorRatePct: config.LOADTEST_DEFAULT_ERROR_RATE_PCT,
    }),
  });
}

export type LoadTestProfile = z.infer<ReturnType<typeof createLoadTestProfileSchema>>;
export type LoadTestThresholds = z.infer<ReturnType<typeof createLoadTestThresholdsSchema>>;
