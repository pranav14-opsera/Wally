import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { EntityNotFoundError, ValidationError } from '../../../../../src/adapters/data/errors.js';
import { MongooseDriftEventRepository } from '../../../../../src/adapters/data/mongoose/MongooseDriftEventRepository.js';
import { MongooseJobStepRepository } from '../../../../../src/adapters/data/mongoose/MongooseJobStepRepository.js';
import { MAX_JOB_STEPS } from '../../../../../src/adapters/data/mongoose/schemas/AgentJob.schema.js';

const silentLogger = pino({ level: 'silent' });

function createMockQuery<T>(resolvedValue: T): Record<string, Mock> & PromiseLike<T> {
  const query: Record<string, Mock> & { then?: unknown } = {
    select: vi.fn(() => query),
    session: vi.fn(() => query),
    lean: vi.fn(() => query),
  };
  query.then = (onFulfilled?: (v: T) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(resolvedValue).then(onFulfilled, onRejected);
  return query as Record<string, Mock> & PromiseLike<T>;
}

function createMockSession(): { withTransaction: Mock; endSession: Mock } {
  return {
    withTransaction: vi.fn(async (fn: () => Promise<void>) => {
      await fn();
    }),
    endSession: vi.fn().mockResolvedValue(undefined),
  };
}

const PARENT_JOB = {
  _id: 'job-1',
  job_steps: [
    { _id: 'step-1', step_order: 1, step_name: 'first', status: 'pending' },
    { _id: 'step-2', step_order: 2, step_name: 'second', status: 'pending' },
  ],
};

describe('MongooseJobStepRepository (via MongooseEmbeddedArrayRepository)', () => {
  let parentModel: {
    findOne: Mock;
    findById: Mock;
    updateOne: Mock;
    db: { startSession: Mock };
  };
  let repo: MongooseJobStepRepository;

  beforeEach(() => {
    parentModel = {
      findOne: vi.fn(),
      findById: vi.fn(),
      updateOne: vi.fn(),
      db: { startSession: vi.fn().mockResolvedValue(createMockSession()) },
    };
    repo = new MongooseJobStepRepository(parentModel as never, silentLogger);
  });

  describe('findById', () => {
    it('finds the parent by the embedded step id and returns the mapped step with job_id injected', async () => {
      parentModel.findOne.mockReturnValue(createMockQuery(PARENT_JOB));

      const result = await repo.findById('step-1');

      expect(parentModel.findOne).toHaveBeenCalledWith({ 'job_steps._id': 'step-1' });
      expect(result).toMatchObject({ id: 'step-1', job_id: 'job-1', step_order: 1, step_name: 'first' });
    });

    it('returns null when no parent contains a matching embedded step', async () => {
      parentModel.findOne.mockReturnValue(createMockQuery(null));
      await expect(repo.findById('missing')).resolves.toBeNull();
    });
  });

  describe('findMany', () => {
    it('requires an eq filter on job_id and throws ValidationError without one', async () => {
      await expect(repo.findMany()).rejects.toBeInstanceOf(ValidationError);
      await expect(repo.findMany({ step_order: { operator: 'eq', value: 1 } })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('returns every embedded step for the given job_id, mapped with job_id injected', async () => {
      parentModel.findById.mockReturnValue(createMockQuery(PARENT_JOB));

      const result = await repo.findMany({ job_id: { operator: 'eq', value: 'job-1' } });

      expect(parentModel.findById).toHaveBeenCalledWith('job-1');
      expect(result.total).toBe(2);
      expect(result.items.map((s) => s.id)).toEqual(['step-1', 'step-2']);
      expect(result.items.every((s) => s.job_id === 'job-1')).toBe(true);
    });

    it('returns an empty result when the parent job does not exist', async () => {
      parentModel.findById.mockReturnValue(createMockQuery(null));
      const result = await repo.findMany({ job_id: { operator: 'eq', value: 'missing' } });
      expect(result).toEqual({ items: [], total: 0, hasNext: false });
    });

    it('applies remaining (non-job_id) filters in-memory', async () => {
      parentModel.findById.mockReturnValue(createMockQuery(PARENT_JOB));

      const result = await repo.findMany({
        job_id: { operator: 'eq', value: 'job-1' },
        step_order: { operator: 'eq', value: 2 },
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe('step-2');
    });

    it('applies sort in-memory', async () => {
      parentModel.findById.mockReturnValue(createMockQuery(PARENT_JOB));

      const result = await repo.findMany({ job_id: { operator: 'eq', value: 'job-1' } }, { step_order: 'desc' });

      expect(result.items.map((s) => s.id)).toEqual(['step-2', 'step-1']);
    });

    it('applies offset pagination in-memory', async () => {
      parentModel.findById.mockReturnValue(createMockQuery(PARENT_JOB));

      const result = await repo.findMany({ job_id: { operator: 'eq', value: 'job-1' } }, undefined, {
        kind: 'offset',
        offset: 1,
        limit: 1,
      });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(2);
      expect(result.hasNext).toBe(false);
    });

    it('logs a performance warning when the embedded array exceeds the warn threshold', async () => {
      const warnSpy = vi.spyOn(silentLogger, 'warn');
      const largeSteps = Array.from({ length: Math.floor(MAX_JOB_STEPS / 2) + 1 }, (_, i) => ({
        _id: `step-${i}`,
        step_order: i,
      }));
      parentModel.findById.mockReturnValue(createMockQuery({ _id: 'job-1', job_steps: largeSteps }));

      await repo.findMany({ job_id: { operator: 'eq', value: 'job-1' } });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ entityName: 'JobStep', arraySize: largeSteps.length }),
        expect.stringContaining('performance warning threshold'),
      );
      warnSpy.mockRestore();
    });

    it('does not log a performance warning when the embedded array is below the threshold', async () => {
      const warnSpy = vi.spyOn(silentLogger, 'warn');
      parentModel.findById.mockReturnValue(createMockQuery(PARENT_JOB));

      await repo.findMany({ job_id: { operator: 'eq', value: 'job-1' } });

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('create', () => {
    it('$push-es a new step onto the parent AgentJob and returns it mapped', async () => {
      parentModel.findById.mockReturnValue(createMockQuery(PARENT_JOB));
      parentModel.updateOne.mockResolvedValue({ matchedCount: 1 });

      const result = await repo.create({ job_id: 'job-1', step_order: 3, step_name: 'third', status: 'pending' });

      expect(parentModel.findById).toHaveBeenCalledWith('job-1');
      expect(parentModel.updateOne).toHaveBeenCalledWith(
        { _id: 'job-1' },
        { $push: { job_steps: expect.objectContaining({ step_order: 3, step_name: 'third' }) } },
        expect.anything(),
      );
      expect(result).toMatchObject({ job_id: 'job-1', step_order: 3, step_name: 'third' });
      expect(result.id).toBeDefined();
    });

    it('throws EntityNotFoundError when the parent AgentJob does not exist', async () => {
      parentModel.findById.mockReturnValue(createMockQuery(null));
      await expect(
        repo.create({ job_id: 'missing', step_order: 1, step_name: 'x', status: 'pending' }),
      ).rejects.toBeInstanceOf(EntityNotFoundError);
      expect(parentModel.updateOne).not.toHaveBeenCalled();
    });

    it('throws ValidationError when job_id is missing from the input', async () => {
      await expect(
        repo.create({ step_order: 1, step_name: 'x', status: 'pending' } as never),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('throws ValidationError without pushing when the embedded array is at the defensive size cap', async () => {
      const fullSteps = Array.from({ length: MAX_JOB_STEPS }, (_, i) => ({ _id: `step-${i}`, step_order: i }));
      parentModel.findById.mockReturnValue(createMockQuery({ _id: 'job-1', job_steps: fullSteps }));

      await expect(
        repo.create({ job_id: 'job-1', step_order: 3, step_name: 'third', status: 'pending' }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(parentModel.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('sets fields via the positional $ operator and returns the updated step', async () => {
      parentModel.findOne.mockReturnValue(createMockQuery(PARENT_JOB));
      parentModel.findById.mockReturnValue(
        createMockQuery({
          ...PARENT_JOB,
          job_steps: [{ ...PARENT_JOB.job_steps[0], status: 'completed' }, PARENT_JOB.job_steps[1]],
        }),
      );
      parentModel.updateOne.mockResolvedValue({ matchedCount: 1 });

      const result = await repo.update('step-1', { status: 'completed' });

      expect(parentModel.updateOne).toHaveBeenCalledWith(
        { 'job_steps._id': 'step-1' },
        { $set: expect.objectContaining({ 'job_steps.$.status': 'completed' }) },
        expect.objectContaining({ runValidators: true }),
      );
      expect(parentModel.findById).toHaveBeenCalledWith('job-1');
      expect(result.status).toBe('completed');
    });

    it('throws EntityNotFoundError when the step does not exist', async () => {
      parentModel.findOne.mockReturnValue(createMockQuery(null));
      await expect(repo.update('missing', { status: 'completed' })).rejects.toBeInstanceOf(EntityNotFoundError);
    });
  });

  describe('delete', () => {
    it('$pull-s the step from the parent array', async () => {
      parentModel.findOne.mockReturnValue(createMockQuery(PARENT_JOB));
      parentModel.updateOne.mockResolvedValue({ matchedCount: 1 });

      await repo.delete('step-1');

      expect(parentModel.updateOne).toHaveBeenCalledWith(
        { _id: 'job-1' },
        { $pull: { job_steps: { _id: 'step-1' } } },
        expect.anything(),
      );
    });

    it('throws EntityNotFoundError when the step does not exist', async () => {
      parentModel.findOne.mockReturnValue(createMockQuery(null));
      await expect(repo.delete('missing')).rejects.toBeInstanceOf(EntityNotFoundError);
    });
  });

  describe('count', () => {
    it('returns the length of the embedded array for the given job_id', async () => {
      parentModel.findById.mockReturnValue(createMockQuery(PARENT_JOB));
      const result = await repo.count({ job_id: { operator: 'eq', value: 'job-1' } });
      expect(result).toBe(2);
    });

    it('requires job_id and throws ValidationError without one', async () => {
      await expect(repo.count()).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('transaction', () => {
    it('starts the session on the parent model\'s own connection', async () => {
      await repo.transaction(async () => 'done');
      expect(parentModel.db.startSession).toHaveBeenCalledTimes(1);
    });

    it('resolves with the value fn returns', async () => {
      const result = await repo.transaction(async () => 'the-result');
      expect(result).toBe('the-result');
    });
  });
});

describe('MongooseDriftEventRepository — wired to the drift_events array', () => {
  it('$push-es onto drift_events, not job_steps', async () => {
    const parentModel = {
      findById: vi.fn().mockReturnValue(createMockQuery({ _id: 'job-1', drift_events: [] })),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      db: { startSession: vi.fn() },
    };
    const repo = new MongooseDriftEventRepository(parentModel as never, silentLogger);

    await repo.create({
      job_id: 'job-1',
      metric_id: 'm-1',
      source_value: 10,
      dashboard_value: 12,
      drift_type: 'value_mismatch',
      affected_records: {},
      detected_at: new Date(),
    });

    expect(parentModel.updateOne).toHaveBeenCalledWith(
      { _id: 'job-1' },
      { $push: { drift_events: expect.objectContaining({ metric_id: 'm-1' }) } },
      expect.anything(),
    );
  });
});
