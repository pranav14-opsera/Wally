import { randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { QueueManager } from '../../src/queue/queue-manager.js';
import { RedisConnectionFactory } from '../../src/queue/redis-connection.js';

// Requires a real, reachable Redis 7 instance — not available by default
// until WO-053's Docker Compose stack exists. Probed once up front (not
// per-test), matching tests/integration/mongoose-schemas.test.ts's
// pattern, so the whole suite skips cleanly with one clear message
// instead of every test failing individually with a connection error.
const REDIS_HOST = process.env.REDIS_HOST ?? 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);
const CONNECTION_TIMEOUT_MS = 2_000;

async function probeRedis(): Promise<boolean> {
  const probe = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    connectTimeout: CONNECTION_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true,
  });
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

const redisAvailable = await probeRedis();

if (!redisAvailable) {
  console.warn(
    `Skipping queue integration tests — no Redis reachable at ${REDIS_HOST}:${REDIS_PORT}. ` +
      'Start one (e.g. `docker compose up -d redis` once WO-053 lands) to run these.',
  );
}

describe.skipIf(!redisAvailable)('QueueManager + RedisConnectionFactory — real Redis', () => {
  const silentLogger = pino({ level: 'silent' });
  let redisFactory: RedisConnectionFactory;
  let queueManager: QueueManager;

  beforeAll(() => {
    redisFactory = new RedisConnectionFactory(silentLogger);
    queueManager = new QueueManager(
      redisFactory,
      { concurrency: 1, jobAttempts: 1, backoffDelayMs: 100, rateLimitMax: 10, rateLimitDurationMs: 1_000 },
      silentLogger,
    );
  });

  afterAll(async () => {
    await queueManager.closeAll();
    await redisFactory.closeAll();
  });

  it('healthCheck reports "ok" with a measured latency once a connection exists', async () => {
    redisFactory.createConnection('health-probe');
    // ioredis with lazyConnect:false connects asynchronously — give it a
    // moment to reach 'ready' before asserting on health status.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const status = await redisFactory.healthCheck('health-probe');
    expect(status.status).toBe('ok');
    expect(status.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('add/retrieve round-trip: a job added to a queue can be retrieved with its original payload', async () => {
    const agentType = `integration-test-${randomUUID()}`;
    const queue = queueManager.createQueue(agentType);

    const job = await queue.add('run', { jobId: 'job-1', input: { seed: 7 } });
    const retrieved = await queue.getJob(job.id!);

    expect(retrieved?.data).toEqual({ jobId: 'job-1', input: { seed: 7 } });
  });

  it('createQueue for the same agent type twice returns a queue whose jobs are visible to both references', async () => {
    const agentType = `integration-test-dedup-${randomUUID()}`;
    const first = queueManager.createQueue(agentType);
    const second = queueManager.createQueue(agentType);

    await first.add('run', { marker: 'added-via-first' });
    const counts = await second.getJobCounts('waiting');
    expect(counts.waiting).toBeGreaterThanOrEqual(1);
  });
});
