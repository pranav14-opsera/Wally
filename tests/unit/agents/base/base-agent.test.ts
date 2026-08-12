import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { AgentJob, JobStep } from '../../../../src/adapters/data/index.js';
import { BaseAgent } from '../../../../src/agents/base/base-agent.js';
import type { AgentStepDefinition } from '../../../../src/agents/base/types.js';
import { JobEventBus } from '../../../../src/gateway/events/job-events.js';

function fakeAgentJob(overrides: Partial<AgentJob> = {}): AgentJob {
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
    ...overrides,
  };
}

function fakeAgentJobRepository(job: AgentJob) {
  const updates: Partial<AgentJob>[] = [];
  return {
    updates,
    findById: vi.fn(async () => job),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(async (_id: string, data: Partial<AgentJob>) => {
      updates.push(data);
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
      const step = steps.find((s) => s.id === id)!;
      Object.assign(step, data);
      return step;
    }),
    delete: vi.fn(),
    count: vi.fn(),
    transaction: vi.fn(),
  };
}

class TestAgent extends BaseAgent<{ shouldFailAt?: number }> {
  protected readonly steps: ReadonlyArray<AgentStepDefinition<{ shouldFailAt?: number }>>;

  public constructor(
    jobId: string,
    agentJobs: ReturnType<typeof fakeAgentJobRepository>,
    jobSteps: ReturnType<typeof fakeJobStepRepository>,
    events: JobEventBus,
    stepCount: number,
  ) {
    super(jobId, agentJobs as never, jobSteps as never, pino({ level: 'silent' }), events);
    this.steps = Array.from({ length: stepCount }, (_, index) => ({
      name: `step-${index}`,
      run: async (context: { shouldFailAt?: number }) => {
        if (context.shouldFailAt === index) {
          throw new Error(`step ${index} failed`);
        }
      },
    }));
  }
}

describe('BaseAgent.run', () => {
  it('marks the job running, then completed, and persists every step as completed', async () => {
    const job = fakeAgentJob();
    const agentJobs = fakeAgentJobRepository(job);
    const jobSteps = fakeJobStepRepository();
    const events = new JobEventBus();
    const received: unknown[] = [];
    events.subscribe(job.id, (event) => received.push(event));

    const agent = new TestAgent(job.id, agentJobs, jobSteps, events, 3);
    await agent.run({});

    expect(agentJobs.update).toHaveBeenCalledWith(job.id, expect.objectContaining({ status: 'running', total_steps: 3 }));
    expect(agentJobs.update).toHaveBeenLastCalledWith(job.id, { status: 'completed', completed_at: expect.any(Date) });
    expect(jobSteps.steps.every((step) => step.status === 'completed')).toBe(true);
    expect(job.current_step).toBe(3);
    expect(received.map((event: any) => event.type)).toEqual([
      'status',
      'step_started',
      'step_completed',
      'step_started',
      'step_completed',
      'step_started',
      'step_completed',
    ]);
  });

  it('marks the job and the failing step as failed, and does not run subsequent steps', async () => {
    const job = fakeAgentJob();
    const agentJobs = fakeAgentJobRepository(job);
    const jobSteps = fakeJobStepRepository();
    const events = new JobEventBus();

    const agent = new TestAgent(job.id, agentJobs, jobSteps, events, 3);
    await expect(agent.run({ shouldFailAt: 1 })).rejects.toThrow('step 1 failed');

    expect(jobSteps.steps).toHaveLength(2);
    expect(jobSteps.steps[0]?.status).toBe('completed');
    expect(jobSteps.steps[1]?.status).toBe('failed');
    expect(jobSteps.steps[1]?.error_message).toBe('step 1 failed');
    expect(job.status).toBe('failed');
    expect(job.error_message).toBe('step 1 failed');
  });

  it('publishes a failed event with the failing step name', async () => {
    const job = fakeAgentJob();
    const agentJobs = fakeAgentJobRepository(job);
    const jobSteps = fakeJobStepRepository();
    const events = new JobEventBus();
    const received: unknown[] = [];
    events.subscribe(job.id, (event) => received.push(event));

    const agent = new TestAgent(job.id, agentJobs, jobSteps, events, 2);
    await expect(agent.run({ shouldFailAt: 0 })).rejects.toThrow();

    expect(received).toContainEqual({ type: 'failed', stepName: 'step-0', error: 'step 0 failed' });
  });
});
