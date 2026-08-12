import pino from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentJob } from '../../../src/adapters/data/entities/AgentJob.js';
import type { JobStep } from '../../../src/adapters/data/entities/JobStep.js';
import { StubRepository } from '../../../src/adapters/data/stubs/stub-repository.js';
import { DuplicateStepNameError, InvalidStateTransitionError, StepExecutionError } from '../../../src/agents/errors.js';
import type { AgentJobConfig } from '../../../src/agents/types.js';
import expectedFinalResult from '../../fixtures/agents/expected-final-result.json';
import expectedStepOutputs from '../../fixtures/agents/expected-step-outputs.json';
import sampleJobInput from '../../fixtures/agents/sample-job-input.json';
import { createMockRedis } from '../../helpers/mock-redis.js';
import {
  buildAsyncFailingStep,
  buildDeterministicSteps,
  buildFailingStep,
  TestAgent,
  type TestAgentInput,
} from '../../helpers/test-agent.js';

const silentLogger = pino({ level: 'silent' });
const CONFIG: AgentJobConfig = { agentType: 'integration', maxRetries: 3, timeoutMs: 30_000 };

function seedJob(agentJobRepository: StubRepository<AgentJob>, overrides: Partial<AgentJob> = {}): Promise<AgentJob> {
  return agentJobRepository.create({
    user_id: 'user-1',
    agent_type: 'integration',
    status: 'queued',
    input_params: sampleJobInput,
    result_summary: null,
    current_step: 0,
    total_steps: 5,
    error_message: null,
    queued_at: new Date('2026-01-01T00:00:00.000Z'),
    started_at: null,
    completed_at: null,
    ...overrides,
  });
}

let agentJobRepository: StubRepository<AgentJob>;
let jobStepRepository: StubRepository<JobStep>;

beforeEach(() => {
  agentJobRepository = new StubRepository<AgentJob>('AgentJob');
  jobStepRepository = new StubRepository<JobStep>('JobStep');
});

describe('BaseAgent', () => {
  describe('constructor dependency validation', () => {
    it.each([
      ['agentJobRepository', [undefined, {}, createMockRedis(), silentLogger, CONFIG]],
      ['jobStepRepository', [{}, undefined, createMockRedis(), silentLogger, CONFIG]],
      ['redis', [{}, {}, undefined, silentLogger, CONFIG]],
      ['logger', [{}, {}, createMockRedis(), undefined, CONFIG]],
      ['config', [{}, {}, createMockRedis(), silentLogger, undefined]],
    ] as const)('throws a descriptive error when %s is null/undefined', (depName, args) => {
      expect(
        () =>
          new TestAgent(
            args[0] as never,
            args[1] as never,
            args[2] as never,
            args[3] as never,
            args[4] as never,
          ),
      ).toThrow(new RegExp(depName === 'config' ? 'AgentJobConfig' : depName, 'i'));
    });
  });

  describe('execute() — happy path', () => {
    it('runs all 5 steps in declared order, accumulating typed context, matching the committed fixtures', async () => {
      const job = await seedJob(agentJobRepository);
      const agent = new TestAgent(agentJobRepository, jobStepRepository, createMockRedis(), silentLogger, CONFIG);

      const result = await agent.execute(job.id, sampleJobInput as TestAgentInput);

      expect(result.status).toBe('completed');
      expect(result.error).toBeNull();
      expect(result.data).toEqual(expectedFinalResult.data);
      expect(result.data).toEqual(expectedStepOutputs);
    });

    it("stores a step's undefined result as a present-but-undefined entry, not an absent one", async () => {
      const job = await seedJob(agentJobRepository);
      const agent = new TestAgent(agentJobRepository, jobStepRepository, createMockRedis(), silentLogger, CONFIG);

      const result = await agent.execute(job.id, sampleJobInput as TestAgentInput);

      expect(result.data).toHaveProperty('step-e');
      expect((result.data as Record<string, unknown>)['step-e']).toBeUndefined();
    });

    it('invokes onStepComplete once per step, in order, with each step\'s own result', async () => {
      const job = await seedJob(agentJobRepository);
      const agent = new TestAgent(agentJobRepository, jobStepRepository, createMockRedis(), silentLogger, CONFIG);

      await agent.execute(job.id, sampleJobInput as TestAgentInput);

      expect(agent.stepCompleteCalls.map((c) => c.stepName)).toEqual(['step-a', 'step-b', 'step-c', 'step-d', 'step-e']);
      expect(agent.stepCompleteCalls[0]?.result).toBe(4);
      expect(agent.stepCompleteCalls[2]?.result).toEqual({ total: 8 });
    });

    it('invokes onJobComplete exactly once, with the final accumulated result', async () => {
      const job = await seedJob(agentJobRepository);
      const agent = new TestAgent(agentJobRepository, jobStepRepository, createMockRedis(), silentLogger, CONFIG);

      await agent.execute(job.id, sampleJobInput as TestAgentInput);

      expect(agent.jobCompleteResult).toEqual(expectedStepOutputs);
      expect(agent.jobFailedError).toBeUndefined();
    });

    it('persists the AgentJob as completed with a result_summary matching the accumulated context', async () => {
      const job = await seedJob(agentJobRepository);
      const agent = new TestAgent(agentJobRepository, jobStepRepository, createMockRedis(), silentLogger, CONFIG);

      await agent.execute(job.id, sampleJobInput as TestAgentInput);

      const persisted = await agentJobRepository.findById(job.id);
      expect(persisted?.status).toBe('completed');
      expect(persisted?.result_summary).toEqual(expectedStepOutputs);
      expect(persisted?.started_at).toBeInstanceOf(Date);
      expect(persisted?.completed_at).toBeInstanceOf(Date);
    });

    it('persists one JobStep record per step, each completed with output_data and duration_ms', async () => {
      const job = await seedJob(agentJobRepository);
      const agent = new TestAgent(agentJobRepository, jobStepRepository, createMockRedis(), silentLogger, CONFIG);

      await agent.execute(job.id, sampleJobInput as TestAgentInput);

      const { items: steps } = await jobStepRepository.findMany({ job_id: { operator: 'eq', value: job.id } });
      expect(steps).toHaveLength(5);
      expect(steps.every((s) => s.status === 'completed')).toBe(true);
      expect(steps.every((s) => typeof s.duration_ms === 'number')).toBe(true);
      // step-c's output_data is already an object ({ total: 8 }) so it is
      // stored as-is; step-a's is a bare number (4), so it's wrapped.
      expect(steps.find((s) => s.step_name === 'step-c')?.output_data).toEqual({ total: 8 });
      expect(steps.find((s) => s.step_name === 'step-a')?.output_data).toEqual({ value: 4 });
    });
  });

  describe('execute() — failure paths', () => {
    it('a step throwing synchronously triggers onJobFailed and resolves with a failed JobResult (does not reject)', async () => {
      const job = await seedJob(agentJobRepository);
      const agent = new TestAgent(agentJobRepository, jobStepRepository, createMockRedis(), silentLogger, CONFIG, [
        buildDeterministicSteps()[0]!,
        buildFailingStep(),
      ]);

      const result = await agent.execute(job.id, sampleJobInput as TestAgentInput);

      expect(result.status).toBe('failed');
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(StepExecutionError);
      expect((result.error as StepExecutionError).stepName).toBe('failing-step');
      expect((result.error as StepExecutionError).stepIndex).toBe(1);
      expect((result.error as StepExecutionError).jobId).toBe(job.id);
      expect(agent.jobFailedError).toBe(result.error);
    });

    it('a step returning a rejected promise is handled identically to a synchronous throw', async () => {
      const job = await seedJob(agentJobRepository);
      const agent = new TestAgent(agentJobRepository, jobStepRepository, createMockRedis(), silentLogger, CONFIG, [
        buildAsyncFailingStep(),
      ]);

      const result = await agent.execute(job.id, sampleJobInput as TestAgentInput);

      expect(result.status).toBe('failed');
      expect((result.error as StepExecutionError).stepName).toBe('async-failing-step');
    });

    it('persists the AgentJob as failed with error_message set, and the failing JobStep as failed', async () => {
      const job = await seedJob(agentJobRepository);
      const agent = new TestAgent(agentJobRepository, jobStepRepository, createMockRedis(), silentLogger, CONFIG, [
        buildFailingStep(),
      ]);

      await agent.execute(job.id, sampleJobInput as TestAgentInput);

      const persistedJob = await agentJobRepository.findById(job.id);
      expect(persistedJob?.status).toBe('failed');
      expect(persistedJob?.error_message).toContain('failing-step');

      const { items: steps } = await jobStepRepository.findMany({ job_id: { operator: 'eq', value: job.id } });
      expect(steps[0]?.status).toBe('failed');
      expect(steps[0]?.error_message).toBeTruthy();
    });

    it('a step that fails does not run subsequent steps', async () => {
      const job = await seedJob(agentJobRepository);
      const neverRuns = { name: 'never-runs', handler: () => 'should not execute' };
      const agent = new TestAgent(agentJobRepository, jobStepRepository, createMockRedis(), silentLogger, CONFIG, [
        buildFailingStep(),
        neverRuns,
      ]);

      await agent.execute(job.id, sampleJobInput as TestAgentInput);

      const { items: steps } = await jobStepRepository.findMany({ job_id: { operator: 'eq', value: job.id } });
      expect(steps).toHaveLength(1);
      expect(steps[0]?.step_name).toBe('failing-step');
    });
  });

  describe('execute() — edge cases', () => {
    it('an empty defineSteps() array completes the job immediately with an empty result', async () => {
      const job = await seedJob(agentJobRepository);
      const agent = new TestAgent(agentJobRepository, jobStepRepository, createMockRedis(), silentLogger, CONFIG, []);

      const result = await agent.execute(job.id, sampleJobInput as TestAgentInput);

      expect(result.status).toBe('completed');
      expect(result.data).toEqual({});

      const { items: steps } = await jobStepRepository.findMany({ job_id: { operator: 'eq', value: job.id } });
      expect(steps).toHaveLength(0);
    });

    it('duplicate step names throw DuplicateStepNameError before any step runs', async () => {
      const job = await seedJob(agentJobRepository);
      const agent = new TestAgent(agentJobRepository, jobStepRepository, createMockRedis(), silentLogger, CONFIG, [
        { name: 'dup', handler: () => 1 },
        { name: 'dup', handler: () => 2 },
      ]);

      await expect(agent.execute(job.id, sampleJobInput as TestAgentInput)).rejects.toBeInstanceOf(
        DuplicateStepNameError,
      );

      const { items: steps } = await jobStepRepository.findMany({ job_id: { operator: 'eq', value: job.id } });
      expect(steps).toHaveLength(0);
    });

    it('rejects with InvalidStateTransitionError when execute() is called on an already-completed job', async () => {
      const job = await seedJob(agentJobRepository, { status: 'completed' });
      const agent = new TestAgent(agentJobRepository, jobStepRepository, createMockRedis(), silentLogger, CONFIG);

      await expect(agent.execute(job.id, sampleJobInput as TestAgentInput)).rejects.toBeInstanceOf(
        InvalidStateTransitionError,
      );
    });

    it('rejects with InvalidStateTransitionError when execute() is called on an already-failed job', async () => {
      const job = await seedJob(agentJobRepository, { status: 'failed' });
      const agent = new TestAgent(agentJobRepository, jobStepRepository, createMockRedis(), silentLogger, CONFIG);

      await expect(agent.execute(job.id, sampleJobInput as TestAgentInput)).rejects.toBeInstanceOf(
        InvalidStateTransitionError,
      );
    });

    it('throws a descriptive error for an unknown jobId, without touching the step repository', async () => {
      const agent = new TestAgent(agentJobRepository, jobStepRepository, createMockRedis(), silentLogger, CONFIG);

      await expect(agent.execute('does-not-exist', sampleJobInput as TestAgentInput)).rejects.toThrow(
        /does-not-exist/,
      );

      const { items: steps } = await jobStepRepository.findMany();
      expect(steps).toHaveLength(0);
    });

    it('a paused job can resume — execute() succeeds when the persisted status is "paused"', async () => {
      const job = await seedJob(agentJobRepository, { status: 'paused' });
      const agent = new TestAgent(agentJobRepository, jobStepRepository, createMockRedis(), silentLogger, CONFIG);

      const result = await agent.execute(job.id, sampleJobInput as TestAgentInput);
      expect(result.status).toBe('completed');
    });
  });
});
