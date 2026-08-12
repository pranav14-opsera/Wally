// Relative import, not the @config alias — see the note in
// src/logging/logger.ts for why cross-module imports in src/ use real
// relative paths rather than tsconfig path aliases.
import { getConfig } from '../config/index.js';

export interface QueueConfig {
  concurrency: number;
  jobAttempts: number;
  backoffDelayMs: number;
  /** Applied by the Worker (WO-032) — BullMQ's rate limiter is a Worker-level option, not a Queue-level one. */
  rateLimitMax: number;
  rateLimitDurationMs: number;
}

export function loadQueueConfig(): QueueConfig {
  const config = getConfig();
  return {
    concurrency: config.QUEUE_CONCURRENCY,
    jobAttempts: config.QUEUE_JOB_ATTEMPTS,
    backoffDelayMs: config.QUEUE_BACKOFF_DELAY_MS,
    rateLimitMax: config.QUEUE_RATE_LIMIT_MAX,
    rateLimitDurationMs: config.QUEUE_RATE_LIMIT_DURATION_MS,
  };
}
