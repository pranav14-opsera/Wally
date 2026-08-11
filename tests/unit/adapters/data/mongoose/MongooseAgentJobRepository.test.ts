import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { MongooseAgentJobRepository } from '../../../../../src/adapters/data/mongoose/MongooseAgentJobRepository.js';

const silentLogger = pino({ level: 'silent' });

function createMockQuery<T>(resolvedValue: T): Record<string, Mock> & PromiseLike<T> {
  const query: Record<string, Mock> & { then?: unknown } = {
    session: vi.fn(() => query),
    lean: vi.fn(() => query),
  };
  query.then = (onFulfilled?: (v: T) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(resolvedValue).then(onFulfilled, onRejected);
  return query as Record<string, Mock> & PromiseLike<T>;
}

const BASE_JOB = {
  _id: 'job-1',
  user_id: 'u-1',
  agent_type: 'integration',
  status: 'queued',
  input_params: {},
  result_summary: null,
  current_step: 0,
  total_steps: 2,
  error_message: null,
  queued_at: new Date(),
  started_at: null,
  completed_at: null,
  created_at: new Date(),
  updated_at: new Date(),
  __v: 0,
};

describe('MongooseAgentJobRepository', () => {
  let model: { findById: Mock; db: { startSession: Mock } };
  let repo: MongooseAgentJobRepository;

  beforeEach(() => {
    model = { findById: vi.fn(), db: { startSession: vi.fn() } };
    repo = new MongooseAgentJobRepository(model as never, silentLogger);
  });

  describe('findByIdWithSteps', () => {
    it('sorts embedded job_steps by step_order and injects job_id into each', async () => {
      const doc = {
        ...BASE_JOB,
        job_steps: [
          { _id: 'step-2', step_order: 2, step_name: 'second' },
          { _id: 'step-1', step_order: 1, step_name: 'first' },
        ],
      };
      model.findById.mockReturnValue(createMockQuery(doc));

      const result = await repo.findByIdWithSteps('job-1');

      expect(result?.job_steps).toHaveLength(2);
      expect(result?.job_steps[0]).toMatchObject({ id: 'step-1', job_id: 'job-1', step_order: 1 });
      expect(result?.job_steps[1]).toMatchObject({ id: 'step-2', job_id: 'job-1', step_order: 2 });
    });

    it('returns null when the job does not exist', async () => {
      model.findById.mockReturnValue(createMockQuery(null));
      await expect(repo.findByIdWithSteps('missing')).resolves.toBeNull();
    });

    it('returns an empty array when the job has no embedded steps', async () => {
      model.findById.mockReturnValue(createMockQuery({ ...BASE_JOB, job_steps: undefined }));
      const result = await repo.findByIdWithSteps('job-1');
      expect(result?.job_steps).toEqual([]);
    });

    it('maps a driver error through mapMongooseError', async () => {
      model.findById.mockReturnValue({
        session: vi.fn().mockReturnThis(),
        lean: vi.fn().mockRejectedValue(new Error('boom')),
      });
      await expect(repo.findByIdWithSteps('job-1')).rejects.toThrow(/boom/);
    });
  });

  describe('findByIdWithDriftEvents', () => {
    it('maps embedded drift_events and injects job_id into each', async () => {
      const doc = {
        ...BASE_JOB,
        drift_events: [{ _id: 'drift-1', metric_id: 'm-1', source_value: 10, dashboard_value: 12 }],
      };
      model.findById.mockReturnValue(createMockQuery(doc));

      const result = await repo.findByIdWithDriftEvents('job-1');

      expect(result?.drift_events).toEqual([
        { id: 'drift-1', job_id: 'job-1', metric_id: 'm-1', source_value: 10, dashboard_value: 12 },
      ]);
    });

    it('returns null when the job does not exist', async () => {
      model.findById.mockReturnValue(createMockQuery(null));
      await expect(repo.findByIdWithDriftEvents('missing')).resolves.toBeNull();
    });
  });
});
