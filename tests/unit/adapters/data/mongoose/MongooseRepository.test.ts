import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { EntityNotFoundError, TransactionError } from '../../../../../src/adapters/data/errors.js';
import { MongooseRepository } from '../../../../../src/adapters/data/mongoose/MongooseRepository.js';
import type { BaseEntity } from '../../../../../src/adapters/data/types.js';

interface Sample extends BaseEntity {
  name: string;
  age: number;
}

const silentLogger = pino({ level: 'silent' });

/**
 * Mongoose `Query` objects are thenable — every chain method (`.session`,
 * `.sort`, `.skip`, `.limit`, `.lean`) returns the *same* query object,
 * and `await` works regardless of which method the chain ends on (not
 * only after `.lean()`). This mock reproduces that: all chain methods
 * are recorded and return `this`, and the object itself implements
 * `.then()` so `await query` resolves to `resolvedValue` from anywhere
 * in the chain.
 */
function createMockQuery<T>(resolvedValue: T): Record<string, Mock> & PromiseLike<T> {
  const query: Record<string, Mock> & { then?: unknown } = {
    session: vi.fn(() => query),
    sort: vi.fn(() => query),
    skip: vi.fn(() => query),
    limit: vi.fn(() => query),
    lean: vi.fn(() => query),
  };
  query.then = (onFulfilled?: (v: T) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(resolvedValue).then(onFulfilled, onRejected);
  return query as Record<string, Mock> & PromiseLike<T>;
}

const SAMPLE_LEAN = { _id: 's-1', name: 'Ada', age: 30, created_at: new Date(), updated_at: new Date(), __v: 0 };
const SAMPLE_DOMAIN = { id: 's-1', name: 'Ada', age: 30, created_at: SAMPLE_LEAN.created_at, updated_at: SAMPLE_LEAN.updated_at };

/** A minimal mock of a MongoDB/Mongoose ClientSession: `withTransaction` just invokes the callback once and `endSession` resolves. */
function createMockSession(): { withTransaction: Mock; endSession: Mock } {
  return {
    withTransaction: vi.fn(async (fn: () => Promise<void>) => {
      await fn();
    }),
    endSession: vi.fn().mockResolvedValue(undefined),
  };
}

describe('MongooseRepository', () => {
  let model: {
    findById: Mock;
    find: Mock;
    countDocuments: Mock;
    findByIdAndUpdate: Mock;
    findByIdAndDelete: Mock;
    insertMany: Mock;
    db: { startSession: Mock };
  };
  let mockSession: { withTransaction: Mock; endSession: Mock };
  let repo: MongooseRepository<Sample>;

  beforeEach(() => {
    mockSession = createMockSession();
    model = {
      findById: vi.fn(),
      find: vi.fn(),
      countDocuments: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      findByIdAndDelete: vi.fn(),
      insertMany: vi.fn(),
      db: { startSession: vi.fn().mockResolvedValue(mockSession) },
    };
    repo = new MongooseRepository<Sample>(model as never, 'Sample', silentLogger);
  });

  describe('findById', () => {
    it('returns the mapped entity when found', async () => {
      model.findById.mockReturnValue(createMockQuery(SAMPLE_LEAN));
      const result = await repo.findById('s-1');
      expect(result).toEqual(SAMPLE_DOMAIN);
      expect(model.findById).toHaveBeenCalledWith('s-1');
    });

    it('returns null when not found (does not throw)', async () => {
      model.findById.mockReturnValue(createMockQuery(null));
      await expect(repo.findById('missing')).resolves.toBeNull();
    });

    it('maps a driver error through mapMongooseError', async () => {
      model.findById.mockReturnValue({
        session: vi.fn().mockReturnThis(),
        lean: vi.fn().mockRejectedValue(new Error('connection lost')),
      });
      await expect(repo.findById('s-1')).rejects.toThrow(/connection lost/);
    });
  });

  describe('findMany', () => {
    it('returns items and total for a plain query with no pagination', async () => {
      model.find.mockReturnValue(createMockQuery([SAMPLE_LEAN]));
      model.countDocuments.mockReturnValue(createMockQuery(1));

      const result = await repo.findMany({ name: { operator: 'eq', value: 'Ada' } });

      expect(model.find).toHaveBeenCalledWith({ name: { $eq: 'Ada' } });
      expect(result).toEqual({ items: [SAMPLE_DOMAIN], total: 1, hasNext: false });
    });

    it('offset pagination: hasNext true when more rows remain', async () => {
      model.find.mockReturnValue(createMockQuery([SAMPLE_LEAN]));
      model.countDocuments.mockReturnValue(createMockQuery(5));

      const result = await repo.findMany(undefined, undefined, { kind: 'offset', offset: 0, limit: 1 });
      expect(result).toEqual({ items: [SAMPLE_DOMAIN], total: 5, hasNext: true });
    });

    it('cursor pagination: over-fetch reveals a next page and trims the probe record', async () => {
      const second = { ...SAMPLE_LEAN, _id: 's-2' };
      const probe = { ...SAMPLE_LEAN, _id: 's-3' };
      model.find.mockReturnValue(createMockQuery([SAMPLE_LEAN, second, probe]));
      model.countDocuments.mockReturnValue(createMockQuery(10));

      const result = await repo.findMany(undefined, undefined, { kind: 'cursor', limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.hasNext).toBe(true);
      expect(result.nextCursor).toBe('s-2');
    });

    it('cursor mode with an explicit cursor first fetches the cursor document to resolve its sort-field value', async () => {
      model.findById.mockReturnValue(createMockQuery(SAMPLE_LEAN));
      model.find.mockReturnValue(createMockQuery([]));
      model.countDocuments.mockReturnValue(createMockQuery(1));

      await repo.findMany(undefined, undefined, { kind: 'cursor', limit: 10, cursor: 's-1' });

      expect(model.findById).toHaveBeenCalledWith('s-1');
    });

    it('maps a driver error through mapMongooseError', async () => {
      model.find.mockReturnValue({
        session: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockRejectedValue(new Error('boom')),
      });
      model.countDocuments.mockReturnValue(createMockQuery(0));
      await expect(repo.findMany()).rejects.toThrow(/boom/);
    });
  });

  describe('create', () => {
    it('creates and returns the mapped entity', async () => {
      const saved = { ...SAMPLE_LEAN };
      const ModelCtor = vi.fn().mockImplementation(() => ({
        save: vi.fn().mockResolvedValue(undefined),
        toObject: vi.fn().mockReturnValue(saved),
      }));
      const modelWithCtor = Object.assign(ModelCtor, model);
      const repoWithCtor = new MongooseRepository<Sample>(modelWithCtor as never, 'Sample', silentLogger);

      const { id: _id, created_at: _c, updated_at: _u, ...input } = SAMPLE_DOMAIN;
      const result = await repoWithCtor.create(input);

      expect(result).toEqual(SAMPLE_DOMAIN);
    });

    it('maps a duplicate-key driver error', async () => {
      const ModelCtor = vi.fn().mockImplementation(() => ({
        save: vi.fn().mockRejectedValue(new Error('duplicate key')),
      }));
      const modelWithCtor = Object.assign(ModelCtor, model);
      const repoWithCtor = new MongooseRepository<Sample>(modelWithCtor as never, 'Sample', silentLogger);

      const { id: _id, created_at: _c, updated_at: _u, ...input } = SAMPLE_DOMAIN;
      await expect(repoWithCtor.create(input)).rejects.toThrow(/duplicate key/);
    });
  });

  describe('createMany', () => {
    it('uses insertMany with ordered:false and returns the mapped entities', async () => {
      const savedDoc = { toObject: vi.fn().mockReturnValue(SAMPLE_LEAN) };
      model.insertMany.mockResolvedValue([savedDoc]);

      const { id: _id, created_at: _c, updated_at: _u, ...input } = SAMPLE_DOMAIN;
      const result = await repo.createMany([input]);

      expect(model.insertMany).toHaveBeenCalledWith([input], expect.objectContaining({ ordered: false }));
      expect(result).toEqual([SAMPLE_DOMAIN]);
    });
  });

  describe('update', () => {
    it('updates and returns the mapped entity', async () => {
      const updated = { ...SAMPLE_LEAN, name: 'Grace' };
      model.findByIdAndUpdate.mockReturnValue(createMockQuery(updated));

      const result = await repo.update('s-1', { name: 'Grace' });

      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        's-1',
        { name: 'Grace' },
        expect.objectContaining({ new: true, runValidators: true }),
      );
      expect(result.name).toBe('Grace');
    });

    it('throws EntityNotFoundError when the target does not exist', async () => {
      model.findByIdAndUpdate.mockReturnValue(createMockQuery(null));
      await expect(repo.update('missing', { name: 'x' })).rejects.toBeInstanceOf(EntityNotFoundError);
    });
  });

  describe('delete', () => {
    it('deletes without returning a value', async () => {
      model.findByIdAndDelete.mockReturnValue(createMockQuery(SAMPLE_LEAN));
      await expect(repo.delete('s-1')).resolves.toBeUndefined();
    });

    it('throws EntityNotFoundError when the target does not exist', async () => {
      model.findByIdAndDelete.mockReturnValue(createMockQuery(null));
      await expect(repo.delete('missing')).rejects.toBeInstanceOf(EntityNotFoundError);
    });
  });

  describe('count', () => {
    it('passes the translated query through to countDocuments', async () => {
      model.countDocuments.mockReturnValue(createMockQuery(3));
      const result = await repo.count({ age: { operator: 'gte', value: 18 } });
      expect(model.countDocuments).toHaveBeenCalledWith({ age: { $gte: 18 } });
      expect(result).toBe(3);
    });
  });

  describe('transaction', () => {
    it('starts the session on the model\'s own connection (model.db), not the global mongoose object', async () => {
      await repo.transaction(async () => 'done');
      expect(model.db.startSession).toHaveBeenCalledTimes(1);
    });

    it('resolves with the value fn returns', async () => {
      const result = await repo.transaction(async () => 'the-result');
      expect(result).toBe('the-result');
    });

    it('always ends the session, even when fn succeeds', async () => {
      await repo.transaction(async () => 'done');
      expect(mockSession.endSession).toHaveBeenCalledTimes(1);
    });

    it('ends the session even when fn throws', async () => {
      await expect(
        repo.transaction(async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow();
      expect(mockSession.endSession).toHaveBeenCalledTimes(1);
    });

    it('routes queries made inside fn through the session', async () => {
      model.findById.mockReturnValue(createMockQuery(SAMPLE_LEAN));

      await repo.transaction(async () => repo.findById('s-1'));

      const sessionArg = model.findById.mock.results[0]?.value.session.mock.calls[0]?.[0];
      expect(sessionArg).toBe(mockSession);
    });

    it('rejects a nested transaction attempt with TransactionError', async () => {
      await expect(
        repo.transaction(async () => {
          return repo.transaction(async () => 'nested');
        }),
      ).rejects.toThrow(TransactionError);
    });

    it('propagates an arbitrary application error thrown inside fn unchanged, matching withTransaction semantics', async () => {
      class InsufficientFundsError extends Error {}
      const original = new InsufficientFundsError('not enough balance');

      const rejection = repo.transaction(async () => {
        throw original;
      });

      await expect(rejection).rejects.toBe(original);
      await expect(rejection).rejects.toBeInstanceOf(InsufficientFundsError);
    });

    it('normalizes a genuine Mongoose transaction error thrown inside fn', async () => {
      const mongoose = await import('mongoose');
      const transactionError = new mongoose.mongo.MongoServerError({
        message: 'transient conflict',
        errorLabels: ['TransientTransactionError'],
      });

      const rejection = repo.transaction(async () => {
        throw transactionError;
      });

      await expect(rejection).rejects.toBeInstanceOf(TransactionError);
    });
  });
});
