import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentJob } from '../../../src/adapters/data/entities/AgentJob.js';
import type { JobStep } from '../../../src/adapters/data/entities/JobStep.js';
import { StubRepository } from '../../../src/adapters/data/stubs/stub-repository.js';
import { JobPersistence } from '../../../src/agents/job-persistence.js';
import { createAgentJobFixture, createJobStepFixture } from '../../fixtures/entities/index.js';

let agentJobRepository: StubRepository<AgentJob>;
let jobStepRepository: StubRepository<JobStep>;
let persistence: JobPersistence;

beforeEach(() => {
  agentJobRepository = new StubRepository<AgentJob>('AgentJob');
  jobStepRepository = new StubRepository<JobStep>('JobStep');
  persistence = new JobPersistence(agentJobRepository, jobStepRepository);
});

describe('JobPersistence', () => {
  describe('constructor', () => {
    it('throws a descriptive error when agentJobRepository is null/undefined', () => {
      expect(() => new JobPersistence(undefined as never, jobStepRepository)).toThrow(/agentJobRepository/i);
    });

    it('throws a descriptive error when jobStepRepository is null/undefined', () => {
      expect(() => new JobPersistence(agentJobRepository, undefined as never)).toThrow(/jobStepRepository/i);
    });
  });

  describe('createJob / getJob', () => {
    it('createJob persists a new AgentJob record retrievable via getJob', async () => {
      const created = await persistence.createJob(stripId(createAgentJobFixture()));

      await expect(persistence.getJob(created.id)).resolves.toEqual(created);
    });

    it('getJob returns null for an unknown jobId', async () => {
      await expect(persistence.getJob('does-not-exist')).resolves.toBeNull();
    });
  });

  describe('updateJobStatus', () => {
    it('updates the status field and merges any extra fields in the same call', async () => {
      const job = await agentJobRepository.create(stripId(createAgentJobFixture({ status: 'queued' })));

      const updated = await persistence.updateJobStatus(job.id, 'running', { started_at: new Date('2026-01-01') });

      expect(updated.status).toBe('running');
      expect(updated.started_at).toEqual(new Date('2026-01-01'));
    });

    it('updates status alone when no extra fields are given', async () => {
      const job = await agentJobRepository.create(stripId(createAgentJobFixture({ status: 'queued' })));
      const updated = await persistence.updateJobStatus(job.id, 'completed');
      expect(updated.status).toBe('completed');
    });
  });

  describe('createJobStep / completeJobStep / failJobStep', () => {
    it('createJobStep persists a running JobStep with the given order, name, and input data', async () => {
      const step = await persistence.createJobStep('job-1', 2, 'validate', { seed: 1 });

      expect(step.job_id).toBe('job-1');
      expect(step.step_order).toBe(2);
      expect(step.step_name).toBe('validate');
      expect(step.status).toBe('running');
      expect(step.input_data).toEqual({ seed: 1 });
      expect(step.started_at).toBeInstanceOf(Date);
      expect(step.completed_at).toBeNull();
    });

    it('completeJobStep marks the step completed with output_data and duration_ms', async () => {
      const step = await persistence.createJobStep('job-1', 0, 'step-a', {});
      const completed = await persistence.completeJobStep(step.id, { total: 8 }, 42);

      expect(completed.status).toBe('completed');
      expect(completed.output_data).toEqual({ total: 8 });
      expect(completed.duration_ms).toBe(42);
      expect(completed.completed_at).toBeInstanceOf(Date);
    });

    it('failJobStep marks the step failed with error_message and duration_ms', async () => {
      const step = await persistence.createJobStep('job-1', 0, 'step-a', {});
      const failed = await persistence.failJobStep(step.id, 'boom', 17);

      expect(failed.status).toBe('failed');
      expect(failed.error_message).toBe('boom');
      expect(failed.duration_ms).toBe(17);
      expect(failed.completed_at).toBeInstanceOf(Date);
    });
  });

  describe('findJobSteps', () => {
    it('returns every JobStep for a jobId, ordered by step_order', async () => {
      await jobStepRepository.create(stripId(createJobStepFixture({ job_id: 'job-1', step_order: 2, step_name: 'c' })));
      await jobStepRepository.create(stripId(createJobStepFixture({ job_id: 'job-1', step_order: 0, step_name: 'a' })));
      await jobStepRepository.create(stripId(createJobStepFixture({ job_id: 'job-1', step_order: 1, step_name: 'b' })));
      await jobStepRepository.create(stripId(createJobStepFixture({ job_id: 'job-2', step_order: 0, step_name: 'x' })));

      const steps = await persistence.findJobSteps('job-1');

      expect(steps.map((s) => s.step_name)).toEqual(['a', 'b', 'c']);
    });

    it('returns an empty array for a job with no steps', async () => {
      await expect(persistence.findJobSteps('never-had-steps')).resolves.toEqual([]);
    });
  });
});

function stripId<T extends { id: string; created_at: Date; updated_at: Date }>(
  entity: T,
): Omit<T, 'id' | 'created_at' | 'updated_at'> {
  const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...rest } = entity;
  return rest;
}
