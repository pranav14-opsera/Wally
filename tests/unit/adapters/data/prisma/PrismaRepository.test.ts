import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { DuplicateKeyError, EntityNotFoundError, TransactionError } from '../../../../../src/adapters/data/errors.js';
import type { DelegateResolver, PrismaModelDelegate } from '../../../../../src/adapters/data/prisma/PrismaRepository.js';
import { PrismaRepository } from '../../../../../src/adapters/data/prisma/PrismaRepository.js';
import type { BaseEntity } from '../../../../../src/adapters/data/types.js';
import { Prisma } from '../../../../../src/generated/prisma/client.js';
import type { PrismaClient } from '../../../../../src/generated/prisma/client.js';

interface Sample extends BaseEntity {
  name: string;
  age: number;
}

const silentLogger = pino({ level: 'silent' });

function createMockDelegate(): { [K in keyof PrismaModelDelegate<Sample>]: Mock } {
  return {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    createManyAndReturn: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

const SAMPLE: Sample = { id: 's-1', name: 'Ada', age: 30, created_at: new Date(), updated_at: new Date() };

describe('PrismaRepository', () => {
  let baseDelegate: ReturnType<typeof createMockDelegate>;
  let txDelegate: ReturnType<typeof createMockDelegate>;
  let txMarker: object;
  let mockPrisma: PrismaClient;
  let getDelegate: DelegateResolver<Sample>;
  let repo: PrismaRepository<Sample>;

  beforeEach(() => {
    baseDelegate = createMockDelegate();
    txDelegate = createMockDelegate();
    txMarker = { marker: 'tx-client' };

    mockPrisma = {
      $transaction: vi.fn(async (fn: (tx: object) => Promise<unknown>) => fn(txMarker)),
    } as unknown as PrismaClient;

    getDelegate = ((client: unknown) =>
      client === txMarker ? txDelegate : baseDelegate) as unknown as DelegateResolver<Sample>;

    repo = new PrismaRepository<Sample>(mockPrisma, getDelegate, 'Sample', silentLogger);
  });

  describe('findById', () => {
    it('returns the mapped entity when found', async () => {
      baseDelegate.findUnique.mockResolvedValue(SAMPLE);
      const result = await repo.findById('s-1');
      expect(result).toEqual(SAMPLE);
      expect(baseDelegate.findUnique).toHaveBeenCalledWith({ where: { id: 's-1' } });
    });

    it('returns null when not found (does not throw)', async () => {
      baseDelegate.findUnique.mockResolvedValue(null);
      await expect(repo.findById('missing')).resolves.toBeNull();
    });

    it('maps a driver error through mapPrismaError', async () => {
      baseDelegate.findUnique.mockRejectedValue(new Error('connection lost'));
      await expect(repo.findById('s-1')).rejects.toThrow(/connection lost/);
    });
  });

  describe('findMany', () => {
    it('translates filters/sort into where/orderBy and returns items + total', async () => {
      baseDelegate.findMany.mockResolvedValue([SAMPLE]);
      baseDelegate.count.mockResolvedValue(1);

      const result = await repo.findMany({ name: { operator: 'eq', value: 'Ada' } }, { age: 'desc' });

      expect(baseDelegate.findMany).toHaveBeenCalledWith({
        where: { name: { equals: 'Ada' } },
        orderBy: [{ age: 'desc' }],
        skip: undefined,
        take: undefined,
        cursor: undefined,
      });
      expect(result).toEqual({ items: [SAMPLE], total: 1, hasNext: false });
    });

    it('offset pagination: hasNext true when more rows remain beyond this page', async () => {
      baseDelegate.findMany.mockResolvedValue([SAMPLE]);
      baseDelegate.count.mockResolvedValue(5);

      const result = await repo.findMany(undefined, undefined, { kind: 'offset', offset: 0, limit: 1 });
      expect(result).toEqual({ items: [SAMPLE], total: 5, hasNext: true });
    });

    it('offset pagination: hasNext false on the last page', async () => {
      baseDelegate.findMany.mockResolvedValue([SAMPLE]);
      baseDelegate.count.mockResolvedValue(1);

      const result = await repo.findMany(undefined, undefined, { kind: 'offset', offset: 0, limit: 10 });
      expect(result.hasNext).toBe(false);
    });

    it('cursor pagination: over-fetch reveals a next page and trims the probe record', async () => {
      const second: Sample = { ...SAMPLE, id: 's-2' };
      const probe: Sample = { ...SAMPLE, id: 's-3' };
      baseDelegate.findMany.mockResolvedValue([SAMPLE, second, probe]);
      baseDelegate.count.mockResolvedValue(10);

      const result = await repo.findMany(undefined, undefined, { kind: 'cursor', limit: 2 });

      expect(result.items).toEqual([SAMPLE, second]);
      expect(result.hasNext).toBe(true);
      expect(result.nextCursor).toBe('s-2');
    });

    it('cursor pagination: no next page when fewer than limit+1 records come back', async () => {
      baseDelegate.findMany.mockResolvedValue([SAMPLE]);
      baseDelegate.count.mockResolvedValue(1);

      const result = await repo.findMany(undefined, undefined, { kind: 'cursor', limit: 10 });

      expect(result.items).toEqual([SAMPLE]);
      expect(result.hasNext).toBe(false);
      expect(result.nextCursor).toBeUndefined();
    });

    it('maps a driver error through mapPrismaError', async () => {
      baseDelegate.findMany.mockRejectedValue(new Error('boom'));
      baseDelegate.count.mockResolvedValue(0);
      await expect(repo.findMany()).rejects.toThrow(/boom/);
    });
  });

  describe('create', () => {
    it('creates and returns the mapped entity', async () => {
      baseDelegate.create.mockResolvedValue(SAMPLE);
      const { id: _id, created_at: _c, updated_at: _u, ...input } = SAMPLE;
      const result = await repo.create(input);
      expect(baseDelegate.create).toHaveBeenCalledWith({ data: input });
      expect(result).toEqual(SAMPLE);
    });

    it('maps a unique-constraint driver error', async () => {
      baseDelegate.create.mockRejectedValue(new Error('unique violation'));
      const { id: _id, created_at: _c, updated_at: _u, ...input } = SAMPLE;
      await expect(repo.create(input)).rejects.toThrow(/unique violation/);
    });
  });

  describe('createMany', () => {
    it('uses createManyAndReturn so it can return the created entities directly', async () => {
      baseDelegate.createManyAndReturn.mockResolvedValue([SAMPLE]);
      const { id: _id, created_at: _c, updated_at: _u, ...input } = SAMPLE;
      const result = await repo.createMany([input]);
      expect(baseDelegate.createManyAndReturn).toHaveBeenCalledWith({ data: [input] });
      expect(result).toEqual([SAMPLE]);
    });
  });

  describe('update', () => {
    it('updates and returns the mapped entity', async () => {
      const updated = { ...SAMPLE, name: 'Grace' };
      baseDelegate.update.mockResolvedValue(updated);
      const result = await repo.update('s-1', { name: 'Grace' });
      expect(baseDelegate.update).toHaveBeenCalledWith({ where: { id: 's-1' }, data: { name: 'Grace' } });
      expect(result).toEqual(updated);
    });

    it('maps a P2025 driver error to EntityNotFoundError carrying the id it was called with', async () => {
      baseDelegate.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      const rejection = repo.update('missing', { name: 'x' });
      await expect(rejection).rejects.toBeInstanceOf(EntityNotFoundError);
      await expect(rejection).rejects.toThrow(/missing/);
    });
  });

  describe('delete', () => {
    it('deletes without returning a value', async () => {
      baseDelegate.delete.mockResolvedValue(SAMPLE);
      await expect(repo.delete('s-1')).resolves.toBeUndefined();
      expect(baseDelegate.delete).toHaveBeenCalledWith({ where: { id: 's-1' } });
    });
  });

  describe('count', () => {
    it('passes filters through to the delegate', async () => {
      baseDelegate.count.mockResolvedValue(3);
      const result = await repo.count({ age: { operator: 'gte', value: 18 } });
      expect(baseDelegate.count).toHaveBeenCalledWith({ where: { age: { gte: 18 } } });
      expect(result).toBe(3);
    });

    it('passes undefined where when no filters are given', async () => {
      baseDelegate.count.mockResolvedValue(0);
      await repo.count();
      expect(baseDelegate.count).toHaveBeenCalledWith({ where: undefined });
    });
  });

  describe('transaction', () => {
    it('routes calls made inside fn through the transactional delegate, not the base one', async () => {
      txDelegate.findUnique.mockResolvedValue(SAMPLE);

      const result = await repo.transaction(async () => {
        return repo.findById('s-1');
      });

      expect(result).toEqual(SAMPLE);
      expect(txDelegate.findUnique).toHaveBeenCalledWith({ where: { id: 's-1' } });
      expect(baseDelegate.findUnique).not.toHaveBeenCalled();
    });

    it('restores the base delegate for calls made after the transaction completes', async () => {
      txDelegate.findUnique.mockResolvedValue(SAMPLE);
      baseDelegate.findUnique.mockResolvedValue(null);

      await repo.transaction(async () => repo.findById('inside'));
      await repo.findById('after');

      expect(txDelegate.findUnique).toHaveBeenCalledWith({ where: { id: 'inside' } });
      expect(baseDelegate.findUnique).toHaveBeenCalledWith({ where: { id: 'after' } });
    });

    it('rejects a nested transaction attempt with TransactionError', async () => {
      await expect(
        repo.transaction(async () => {
          return repo.transaction(async () => 'nested');
        }),
      ).rejects.toThrow(TransactionError);
    });

    it('does not leak the transactional delegate into a concurrent, unrelated call on the same instance', async () => {
      let releaseTransaction: () => void = () => {};
      const transactionGate = new Promise<void>((resolve) => {
        releaseTransaction = resolve;
      });

      txDelegate.findUnique.mockResolvedValue({ ...SAMPLE, id: 'inside-tx' });
      baseDelegate.findUnique.mockResolvedValue({ ...SAMPLE, id: 'outside-tx' });

      const txPromise = repo.transaction(async () => {
        await repo.findById('inside-tx');
        await transactionGate;
        return 'tx-done';
      });

      // Let the transaction's microtasks (including its first findById) run
      // before firing the concurrent, non-transactional call.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      await repo.findById('outside-tx');

      releaseTransaction();
      await txPromise;

      expect(txDelegate.findUnique).toHaveBeenCalledWith({ where: { id: 'inside-tx' } });
      expect(baseDelegate.findUnique).toHaveBeenCalledWith({ where: { id: 'outside-tx' } });
      // The concurrent call must never have reached the tx delegate.
      expect(txDelegate.findUnique).not.toHaveBeenCalledWith({ where: { id: 'outside-tx' } });
    });

    it('propagates an arbitrary application error thrown inside fn unchanged, matching $transaction semantics', async () => {
      class InsufficientFundsError extends Error {}
      const original = new InsufficientFundsError('not enough balance');

      const rejection = repo.transaction(async () => {
        throw original;
      });

      await expect(rejection).rejects.toBe(original);
      await expect(rejection).rejects.toBeInstanceOf(InsufficientFundsError);
    });

    it('still normalizes a genuine Prisma driver error thrown inside fn', async () => {
      const rejection = repo.transaction(async () => {
        throw new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['email'] },
        });
      });

      await expect(rejection).rejects.toBeInstanceOf(DuplicateKeyError);
    });
  });
});
