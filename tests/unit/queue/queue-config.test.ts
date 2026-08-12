import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { customQueueEnv, defaultRedisEnv } from '../../fixtures/queue/redis-env-configs.fixture.js';
import sampleQueueOptions from '../../fixtures/queue/sample-queue-options.json';
import type { loadQueueConfig as loadQueueConfigType } from '../../../src/queue/queue-config.js';

const ORIGINAL_ENV = process.env;
let loadQueueConfig: typeof loadQueueConfigType;

beforeEach(async () => {
  vi.resetModules();
  ({ loadQueueConfig } = await import('../../../src/queue/queue-config.js'));
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('loadQueueConfig', () => {
  it('reads concurrency, job attempts, backoff, and rate-limit values from env vars', () => {
    process.env = customQueueEnv;

    expect(loadQueueConfig()).toEqual({
      concurrency: 10,
      jobAttempts: 7,
      backoffDelayMs: 3_000,
      rateLimitMax: 50,
      rateLimitDurationMs: 2_000,
    });
  });

  it('falls back to sensible defaults when the QUEUE_* env vars are unset — matching the committed sample-queue-options.json fixture', () => {
    process.env = defaultRedisEnv;

    expect(loadQueueConfig()).toEqual(sampleQueueOptions);
  });
});
