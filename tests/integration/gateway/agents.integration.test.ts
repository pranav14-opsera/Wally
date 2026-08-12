import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentJob, JobStep, LoadTestResult } from '../../../src/adapters/data/index.js';
import { buildApp } from '../../../src/gateway/app.js';
import { fakeGatewayContainer } from '../../helpers/fake-gateway-container.js';

const runK6Mock = vi.fn();
vi.mock('../../../src/agents/load-testing/k6-runner.js', () => ({
  runK6: (...args: unknown[]) => runK6Mock(...args),
}));

function inMemoryAgentJobRepository() {
  const jobs = new Map<string, AgentJob>();
  const steps = new Map<string, JobStep[]>();
  return {
    _jobs: jobs,
    _steps: steps,
    findById: async (id: string) => jobs.get(id) ?? null,
    findMany: async (filters?: { agent_type?: { value?: unknown } }) => {
      const all = Array.from(jobs.values()).filter(
        (job) => !filters?.agent_type || job.agent_type === filters.agent_type.value,
      );
      return { items: all, total: all.length, hasNext: false };
    },
    create: async (data: Omit<AgentJob, 'id' | 'created_at' | 'updated_at'>) => {
      const job: AgentJob = { id: randomUUID(), created_at: new Date(), updated_at: new Date(), ...data };
      jobs.set(job.id, job);
      steps.set(job.id, []);
      return job;
    },
    createMany: async () => [],
    update: async (id: string, data: Partial<AgentJob>) => {
      const job = jobs.get(id)!;
      Object.assign(job, data);
      return job;
    },
    delete: async () => {},
    count: async () => jobs.size,
    transaction: async () => {
      throw new Error('not implemented');
    },
    findByIdWithSteps: async (id: string) => {
      const job = jobs.get(id);
      return job ? { ...job, job_steps: steps.get(id) ?? [] } : null;
    },
    findByIdWithDriftEvents: async () => null,
  };
}

function inMemoryJobStepRepository(jobsRepo: ReturnType<typeof inMemoryAgentJobRepository>) {
  return {
    findById: async () => null,
    findMany: async () => ({ items: [], total: 0, hasNext: false }),
    create: async (data: Omit<JobStep, 'id' | 'created_at' | 'updated_at'>) => {
      const step: JobStep = { id: randomUUID(), created_at: new Date(), updated_at: new Date(), ...data };
      jobsRepo._steps.get(data.job_id)?.push(step);
      return step;
    },
    createMany: async () => [],
    update: async (id: string, data: Partial<JobStep>) => {
      for (const steps of jobsRepo._steps.values()) {
        const step = steps.find((s) => s.id === id);
        if (step) {
          Object.assign(step, data);
          return step;
        }
      }
      throw new Error('step not found');
    },
    delete: async () => {},
    count: async () => 0,
    transaction: async () => {
      throw new Error('not implemented');
    },
  };
}

function inMemoryLoadTestResultRepository() {
  const results: LoadTestResult[] = [];
  return {
    _results: results,
    findById: async () => null,
    findMany: async (filters?: { job_id?: { value?: unknown } }) => {
      const items = results.filter((r) => !filters?.job_id || r.job_id === filters.job_id.value);
      return { items, total: items.length, hasNext: false };
    },
    create: async (data: Omit<LoadTestResult, 'id' | 'created_at' | 'updated_at'>) => {
      const record: LoadTestResult = { id: randomUUID(), created_at: new Date(), updated_at: new Date(), ...data };
      results.push(record);
      return record;
    },
    createMany: async () => [],
    update: async () => {
      throw new Error('not implemented');
    },
    delete: async () => {},
    count: async () => results.length,
    transaction: async () => {
      throw new Error('not implemented');
    },
  };
}

async function appWithAgentRoutes() {
  const container = fakeGatewayContainer();
  const agentJobs = inMemoryAgentJobRepository();
  (container.dataAdapter.repositories as Record<string, unknown>).agentJobs = agentJobs;
  (container.dataAdapter.repositories as Record<string, unknown>).jobSteps = inMemoryJobStepRepository(agentJobs);
  (container.dataAdapter.repositories as Record<string, unknown>).loadTestResults = inMemoryLoadTestResultRepository();

  const app = await buildApp(container);
  await app.ready();
  return app;
}

const PROFILE = { name: 'smoke', targetUrl: 'http://localhost:9999/', vus: 5, durationSeconds: 5 };

describe('Load Testing Agent REST endpoints (integration)', () => {
  beforeEach(() => {
    runK6Mock.mockReset();
    runK6Mock.mockResolvedValue({
      p50LatencyMs: 10,
      p95LatencyMs: 50,
      p99LatencyMs: 80,
      throughputRps: 20,
      errorRatePct: 0,
      rawMetrics: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lets a Manager trigger a run and returns 202 with a jobId', async () => {
    const app = await appWithAgentRoutes();
    const token = app.jwt.generateAccessToken('manager-1', 'manager@test.com', 'manager');

    const response = await request(app.server)
      .post('/api/v1/agents/load-testing/runs')
      .set('Authorization', `Bearer ${token}`)
      .send(PROFILE);

    expect(response.status).toBe(202);
    expect(response.body.data.jobId).toEqual(expect.any(String));
    await app.close();
  });

  it('denies a Viewer from triggering a run (RBAC)', async () => {
    const app = await appWithAgentRoutes();
    const token = app.jwt.generateAccessToken('viewer-1', 'viewer@test.com', 'viewer');

    const response = await request(app.server)
      .post('/api/v1/agents/load-testing/runs')
      .set('Authorization', `Bearer ${token}`)
      .send(PROFILE);

    expect(response.status).toBe(403);
    await app.close();
  });

  it('rejects an unauthenticated trigger request with 401', async () => {
    const app = await appWithAgentRoutes();

    const response = await request(app.server).post('/api/v1/agents/load-testing/runs').send(PROFILE);

    expect(response.status).toBe(401);
    await app.close();
  });

  it('the triggered run completes and is retrievable with its result and steps', async () => {
    const app = await appWithAgentRoutes();
    const managerToken = app.jwt.generateAccessToken('manager-1', 'manager@test.com', 'manager');
    const viewerToken = app.jwt.generateAccessToken('viewer-1', 'viewer@test.com', 'viewer');

    const trigger = await request(app.server)
      .post('/api/v1/agents/load-testing/runs')
      .set('Authorization', `Bearer ${managerToken}`)
      .send(PROFILE);
    const jobId = trigger.body.data.jobId as string;

    await vi.waitFor(async () => {
      const check = await request(app.server)
        .get(`/api/v1/agents/load-testing/runs/${jobId}`)
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(check.body.data.job.status).toBe('completed');
    });

    const final = await request(app.server)
      .get(`/api/v1/agents/load-testing/runs/${jobId}`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(final.body.data.job.job_steps).toHaveLength(3);
    expect(final.body.data.result).toMatchObject({ slo_verdict: 'pass' });
    await app.close();
  });

  it('returns 404 for an unknown run id', async () => {
    const app = await appWithAgentRoutes();
    const token = app.jwt.generateAccessToken('viewer-1', 'viewer@test.com', 'viewer');

    const response = await request(app.server)
      .get(`/api/v1/agents/load-testing/runs/${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    await app.close();
  });

  it('lists triggered runs for a Viewer', async () => {
    const app = await appWithAgentRoutes();
    const managerToken = app.jwt.generateAccessToken('manager-1', 'manager@test.com', 'manager');
    const viewerToken = app.jwt.generateAccessToken('viewer-1', 'viewer@test.com', 'viewer');
    await request(app.server).post('/api/v1/agents/load-testing/runs').set('Authorization', `Bearer ${managerToken}`).send(PROFILE);

    const response = await request(app.server).get('/api/v1/agents/load-testing/runs').set('Authorization', `Bearer ${viewerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta).toMatchObject({ total: 1 });
    await app.close();
  });
});
