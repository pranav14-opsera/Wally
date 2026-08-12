import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentJob, JobStep, LoadTestResult } from '../../../../src/adapters/data/index.js';
import { LoadTestAgent } from '../../../../src/agents/load-testing/load-test-agent.js';
import type { LoadTestProfile } from '../../../../src/agents/load-testing/schemas.js';
import { JobEventBus } from '../../../../src/gateway/events/job-events.js';

const runK6Mock = vi.fn();
vi.mock('../../../../src/agents/load-testing/k6-runner.js', () => ({
  runK6: (...args: unknown[]) => runK6Mock(...args),
}));

function fakeAgentJob(): AgentJob {
  return {
    id: 'job-1',
    user_id: 'user-1',
    agent_type: 'load_testing',
    status: 'queued',
    input_params: {},
    result_summary: null,
    current_step: 0,
    total_steps: 0,
    error_message: null,
    queued_at: new Date(),
    started_at: null,
    completed_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function fakeAgentJobRepository(job: AgentJob) {
  return {
    findById: vi.fn(async () => job),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(async (_id: string, data: Partial<AgentJob>) => {
      Object.assign(job, data);
      return job;
    }),
    delete: vi.fn(),
    count: vi.fn(),
    transaction: vi.fn(),
    findByIdWithSteps: vi.fn(),
    findByIdWithDriftEvents: vi.fn(),
  };
}

function fakeJobStepRepository() {
  const steps: JobStep[] = [];
  let nextId = 0;
  return {
    steps,
    findById: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(async (data: Omit<JobStep, 'id' | 'created_at' | 'updated_at'>) => {
      const step: JobStep = { id: `step-${nextId++}`, created_at: new Date(), updated_at: new Date(), ...data };
      steps.push(step);
      return step;
    }),
    createMany: vi.fn(),
    update: vi.fn(async (id: string, data: Partial<JobStep>) => {
      Object.assign(
        steps.find((s) => s.id === id)!,
        data,
      );
      return steps.find((s) => s.id === id)!;
    }),
    delete: vi.fn(),
    count: vi.fn(),
    transaction: vi.fn(),
  };
}

function fakeLoadTestResultRepository() {
  const created: Omit<LoadTestResult, 'id' | 'created_at' | 'updated_at'>[] = [];
  return {
    created,
    findById: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(async (data: Omit<LoadTestResult, 'id' | 'created_at' | 'updated_at'>) => {
      created.push(data);
      return { id: 'result-1', created_at: new Date(), updated_at: new Date(), ...data };
    }),
    createMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
    transaction: vi.fn(),
  };
}

const PROFILE: LoadTestProfile = {
  name: 'smoke',
  targetUrl: 'http://localhost:9999/',
  vus: 5,
  durationSeconds: 10,
  thresholds: { p95LatencyMs: 500, errorRatePct: 1 },
};

function buildAgent(job: AgentJob) {
  const agentJobs = fakeAgentJobRepository(job);
  const jobSteps = fakeJobStepRepository();
  const loadTestResults = fakeLoadTestResultRepository();
  const events = new JobEventBus();
  const agent = new LoadTestAgent({
    jobId: job.id,
    agentJobs: agentJobs as never,
    jobSteps: jobSteps as never,
    loadTestResults: loadTestResults as never,
    logger: pino({ level: 'silent' }),
    events,
    k6BinaryPath: 'k6',
    computeTimeoutMs: 5000,
    progressIntervalMs: 1000,
    stderrTailLength: 200,
  });
  return { agent, agentJobs, jobSteps, loadTestResults, events };
}

describe('LoadTestAgent', () => {
  beforeEach(() => {
    runK6Mock.mockReset();
  });

  it('runs all three steps and persists a pass verdict when metrics are within thresholds', async () => {
    runK6Mock.mockResolvedValue({
      p50LatencyMs: 10,
      p95LatencyMs: 50,
      p99LatencyMs: 80,
      throughputRps: 20,
      errorRatePct: 0,
      rawMetrics: {},
    });
    const job = fakeAgentJob();
    const { agent, loadTestResults } = buildAgent(job);

    await agent.run({ profile: PROFILE });

    expect(job.status).toBe('completed');
    expect(loadTestResults.created[0]).toMatchObject({ slo_verdict: 'pass', p95_latency_ms: 50 });
  });

  it('persists a fail verdict when p95 latency exceeds the threshold', async () => {
    runK6Mock.mockResolvedValue({
      p50LatencyMs: 10,
      p95LatencyMs: 999,
      p99LatencyMs: 1200,
      throughputRps: 20,
      errorRatePct: 0,
      rawMetrics: {},
    });
    const job = fakeAgentJob();
    const { agent, loadTestResults } = buildAgent(job);

    await agent.run({ profile: PROFILE });

    expect(loadTestResults.created[0]?.slo_verdict).toBe('fail');
  });

  it('persists a fail verdict when the error rate exceeds the threshold', async () => {
    runK6Mock.mockResolvedValue({
      p50LatencyMs: 10,
      p95LatencyMs: 50,
      p99LatencyMs: 80,
      throughputRps: 20,
      errorRatePct: 25,
      rawMetrics: {},
    });
    const job = fakeAgentJob();
    const { agent, loadTestResults } = buildAgent(job);

    await agent.run({ profile: PROFILE });

    expect(loadTestResults.created[0]?.slo_verdict).toBe('fail');
  });

  it('fails the job and never persists a result when k6 itself fails (e.g. binary missing)', async () => {
    runK6Mock.mockRejectedValue(new Error('k6 binary not found at "k6"'));
    const job = fakeAgentJob();
    const { agent, loadTestResults } = buildAgent(job);

    await expect(agent.run({ profile: PROFILE })).rejects.toThrow(/k6 binary not found/);

    expect(job.status).toBe('failed');
    expect(job.error_message).toMatch(/k6 binary not found/);
    expect(loadTestResults.created).toHaveLength(0);
  });

  it('publishes a completed event carrying the persisted result', async () => {
    runK6Mock.mockResolvedValue({
      p50LatencyMs: 10,
      p95LatencyMs: 50,
      p99LatencyMs: 80,
      throughputRps: 20,
      errorRatePct: 0,
      rawMetrics: {},
    });
    const job = fakeAgentJob();
    const { agent, events } = buildAgent(job);
    const received: unknown[] = [];
    events.subscribe(job.id, (event) => received.push(event));

    await agent.run({ profile: PROFILE });

    const completedEvent = received.find((event: any) => event.type === 'completed') as any;
    expect(completedEvent?.result).toMatchObject({ slo_verdict: 'pass' });
  });
});
