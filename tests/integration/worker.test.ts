import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AgentDispatcher } from '../../src/workers/agent-dispatcher.js';
import { workerBootstrap } from '../../src/workers/worker-bootstrap.js';

// Requires a real, reachable Redis 7 instance — not available by default
// until WO-053's Docker Compose stack exists. Same probe-once-and-skip
// pattern as the other tests/integration/*.test.ts files.
const REDIS_HOST = process.env.REDIS_HOST ?? 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);
const CONNECTION_TIMEOUT_MS = 2_000;
const JOB_PROCESS_WAIT_MS = 5_000;
const POLL_INTERVAL_MS = 100;

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
    `Skipping worker integration tests — no Redis reachable at ${REDIS_HOST}:${REDIS_PORT}. ` +
      'Start one (e.g. `docker compose up -d redis` once WO-053 lands) to run these.',
  );
}

describe.skipIf(!redisAvailable)('Worker process — real Redis + BullMQ (WO-032)', () => {
  const agentType = `integration-test-agent-${Date.now()}`;
  let queue: Queue;
  let container: ReturnType<typeof workerBootstrap>;

  beforeAll(() => {
    const dispatcher = new AgentDispatcher();
    dispatcher.register(agentType, () => ({
      execute: async (jobId: string, input: Record<string, unknown>) =>
        ({ status: 'completed' as const, data: { jobId, echoedInput: input }, error: null }),
    }));

    container = workerBootstrap(dispatcher);
    queue = new Queue(agentType, { connection: new Redis({ host: REDIS_HOST, port: REDIS_PORT, maxRetriesPerRequest: null }) });
  });

  afterAll(async () => {
    await queue.close();
    await container.shutdownHandler.shutdown('SIGTERM');
  });

  it('a job enqueued on the agent-type queue is picked up and completed by the worker', async () => {
    const job = await queue.add('run', { jobId: 'integration-job-1', input: { seed: 3 } });

    const startedAt = Date.now();
    let state = await job.getState();
    while (state !== 'completed' && state !== 'failed' && Date.now() - startedAt < JOB_PROCESS_WAIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      state = await job.getState();
    }

    expect(state).toBe('completed');
    const returnValue = (await job.waitUntilFinished(queue.events, JOB_PROCESS_WAIT_MS)) as {
      data: { jobId: string; echoedInput: Record<string, unknown> };
    };
    expect(returnValue.data.jobId).toBe('integration-job-1');
    expect(returnValue.data.echoedInput).toEqual({ seed: 3 });
  }, JOB_PROCESS_WAIT_MS + 2_000);
});
