import { Redis } from 'ioredis';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AgentJob } from '../../src/adapters/data/entities/AgentJob.js';
import type { JobStep } from '../../src/adapters/data/entities/JobStep.js';
import { StubRepository } from '../../src/adapters/data/stubs/stub-repository.js';
import { StepMemoizer } from '../../src/agents/memoization.js';
import type { AgentJobConfig } from '../../src/agents/types.js';
import { buildDeterministicSteps, buildFailingStep, TestAgent, type TestAgentInput } from '../helpers/test-agent.js';

// Requires a real, reachable Redis 7 instance — not available by default
// until WO-053's Docker Compose stack exists. Same probe-once-and-skip
// pattern as tests/integration/{mongoose-schemas,queue-manager}.test.ts.
const REDIS_HOST = process.env.REDIS_HOST ?? 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);
const CONNECTION_TIMEOUT_MS = 2_000;
const TTL_SECONDS = 3_600;
const LARGE_RESULT_WARN_BYTES = 1_000_000;
const CONFIG: AgentJobConfig = { agentType: 'integration', maxRetries: 3, timeoutMs: 30_000 };

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
    `Skipping crash-resume integration tests — no Redis reachable at ${REDIS_HOST}:${REDIS_PORT}. ` +
      'Start one (e.g. `docker compose up -d redis` once WO-053 lands) to run these.',
  );
}

describe.skipIf(!redisAvailable)('BaseAgent crash-resume — real Redis (WO-031)', () => {
  const silentLogger = pino({ level: 'silent' });
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT, maxRetriesPerRequest: null });
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('executing steps 1-3, "crashing", then re-executing the same jobId serves steps 1-3 from real Redis and runs only steps 4-5 fresh', async () => {
    const agentJobRepository = new StubRepository<AgentJob>('AgentJob');
    const jobStepRepository = new StubRepository<JobStep>('JobStep');
    const memoizer = new StepMemoizer(redis, TTL_SECONDS, silentLogger, LARGE_RESULT_WARN_BYTES);

    const job = await agentJobRepository.create({
      user_id: 'user-1',
      agent_type: 'integration',
      status: 'queued',
      input_params: { seed: 3 },
      result_summary: null,
      current_step: 0,
      total_steps: 5,
      error_message: null,
      queued_at: new Date(),
      started_at: null,
      completed_at: null,
    });

    const callCounts = new Map<string, number>();
    const countingSteps = buildDeterministicSteps().map((step) => ({
      ...step,
      handler: (ctx: Parameters<typeof step.handler>[0]) => {
        callCounts.set(step.name, (callCounts.get(step.name) ?? 0) + 1);
        return step.handler(ctx);
      },
    }));
    const crashingSteps = [...countingSteps.slice(0, 3), buildFailingStep('crash-here'), countingSteps[3]!, countingSteps[4]!];

    const crashedAgent = new TestAgent(agentJobRepository, jobStepRepository, redis, silentLogger, CONFIG, crashingSteps, memoizer);
    const firstResult = await crashedAgent.execute(job.id, { seed: 3 } as TestAgentInput);
    expect(firstResult.status).toBe('failed');

    // Real Redis round-trip: verify the checkpoint genuinely persisted
    // server-side, not just in the same process's memory.
    await expect(memoizer.getCheckpoint(job.id)).resolves.toBe(2);

    await agentJobRepository.update(job.id, { status: 'queued' });
    const resumedAgent = new TestAgent(agentJobRepository, jobStepRepository, redis, silentLogger, CONFIG, countingSteps, memoizer);
    const secondResult = await resumedAgent.execute(job.id, { seed: 3 } as TestAgentInput);

    expect(secondResult.status).toBe('completed');
    expect(callCounts.get('step-a')).toBe(1);
    expect(callCounts.get('step-b')).toBe(1);
    expect(callCounts.get('step-c')).toBe(1);
    expect(callCounts.get('step-d')).toBe(1);
    expect(callCounts.get('step-e')).toBe(1);

    await memoizer.clearJobCache(job.id);
  });

  it('MULTI/EXEC checkpoint write against real Redis is genuinely atomic — result and checkpoint keys both exist or neither does', async () => {
    const memoizer = new StepMemoizer(redis, TTL_SECONDS, silentLogger, LARGE_RESULT_WARN_BYTES);
    const jobId = `atomic-test-${Date.now()}`;

    await memoizer.setStepResult(jobId, 0, { value: 42 });

    await expect(memoizer.hasStepResult(jobId, 0)).resolves.toBe(true);
    await expect(memoizer.getCheckpoint(jobId)).resolves.toBe(0);

    await memoizer.clearJobCache(jobId);
  });
});
