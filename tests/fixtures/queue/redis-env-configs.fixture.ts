import { createValidPostgresEnv } from '../env.fixture.js';

/** Redis/queue-specific env-var scenarios for src/queue/** tests (WO-030 AC13), layered on the shared base env fixture. */

export const defaultRedisEnv: NodeJS.ProcessEnv = createValidPostgresEnv() as NodeJS.ProcessEnv;

export const customRedisEnv: NodeJS.ProcessEnv = createValidPostgresEnv({
  REDIS_HOST: 'redis.internal',
  REDIS_PORT: '6380',
  REDIS_DB: '2',
}) as NodeJS.ProcessEnv;

export const redisWithAuthEnv: NodeJS.ProcessEnv = createValidPostgresEnv({
  REDIS_PASSWORD: 'super-secret',
}) as NodeJS.ProcessEnv;

export const redisInvalidPortEnv: NodeJS.ProcessEnv = createValidPostgresEnv({
  REDIS_PORT: 'not-a-number',
}) as NodeJS.ProcessEnv;

export const customQueueEnv: NodeJS.ProcessEnv = createValidPostgresEnv({
  QUEUE_CONCURRENCY: '10',
  QUEUE_JOB_ATTEMPTS: '7',
  QUEUE_BACKOFF_DELAY_MS: '3000',
  QUEUE_RATE_LIMIT_MAX: '50',
  QUEUE_RATE_LIMIT_DURATION_MS: '2000',
}) as NodeJS.ProcessEnv;
