import { describe, expect, it } from 'vitest';

import { Prisma } from '../../../../../src/generated/prisma/client.js';
import {
  ConnectionError,
  DataAdapterError,
  DuplicateKeyError,
  EntityNotFoundError,
  ForeignKeyViolationError,
  TransactionError,
  ValidationError,
} from '../../../../../src/adapters/data/errors.js';
import { mapPrismaError } from '../../../../../src/adapters/data/prisma/error-mapper.js';

function knownRequestError(code: string, meta?: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('simulated Prisma error', {
    code,
    clientVersion: 'test',
    meta,
  });
}

describe('mapPrismaError', () => {
  it('maps P2002 (unique constraint) to DuplicateKeyError naming the conflicting field', () => {
    const error = mapPrismaError(knownRequestError('P2002', { target: ['email'] }), {
      entityName: 'User',
      operation: 'create',
    });
    expect(error).toBeInstanceOf(DuplicateKeyError);
    expect(error.code).toBe('DUPLICATE_KEY');
    expect(error.message).toContain('email');
  });

  it('maps P2002 with a non-array target gracefully', () => {
    const error = mapPrismaError(knownRequestError('P2002', { target: 'email' }), {
      entityName: 'User',
      operation: 'create',
    });
    expect(error.message).toContain('email');
  });

  it('maps P2002 with no meta at all without throwing', () => {
    const error = mapPrismaError(knownRequestError('P2002'), { entityName: 'User', operation: 'create' });
    expect(error).toBeInstanceOf(DuplicateKeyError);
    expect(error.message).toContain('unknown field');
  });

  it('maps P2025 (record not found) to EntityNotFoundError using the id from context', () => {
    const error = mapPrismaError(knownRequestError('P2025'), {
      entityName: 'AgentJob',
      operation: 'update',
      id: 'job-123',
    });
    expect(error).toBeInstanceOf(EntityNotFoundError);
    expect(error.code).toBe('ENTITY_NOT_FOUND');
    expect(error.message).toContain('job-123');
  });

  it('maps P2025 without an id in context to a generic "unknown" id', () => {
    const error = mapPrismaError(knownRequestError('P2025'), { entityName: 'AgentJob', operation: 'findMany' });
    expect(error).toBeInstanceOf(EntityNotFoundError);
    expect(error.message).toContain('unknown');
  });

  it('maps P2003 (foreign key violation) to ForeignKeyViolationError naming the field', () => {
    const error = mapPrismaError(knownRequestError('P2003', { field_name: 'user_id' }), {
      entityName: 'AgentJob',
      operation: 'create',
    });
    expect(error).toBeInstanceOf(ForeignKeyViolationError);
    expect(error.code).toBe('FOREIGN_KEY_VIOLATION');
    expect(error.message).toContain('user_id');
  });

  it('maps P2028 (transaction API error, including timeout) to TransactionError', () => {
    const error = mapPrismaError(knownRequestError('P2028'), { entityName: 'AgentJob', operation: 'transaction' });
    expect(error).toBeInstanceOf(TransactionError);
    expect(error.code).toBe('TRANSACTION');
  });

  it('maps any P1xxx code to ConnectionError', () => {
    const error = mapPrismaError(knownRequestError('P1001'), { entityName: 'User', operation: 'findById' });
    expect(error).toBeInstanceOf(ConnectionError);
    expect(error.code).toBe('CONNECTION');
    expect(error.message).toContain('P1001');
  });

  it('maps an unrecognized P2xxx code to ValidationError, preserving the code and message', () => {
    const error = mapPrismaError(knownRequestError('P2011', undefined), {
      entityName: 'User',
      operation: 'create',
    });
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.code).toBe('VALIDATION');
    expect(error.message).toContain('P2011');
  });

  it('maps PrismaClientInitializationError to ConnectionError', () => {
    const initError = new Prisma.PrismaClientInitializationError('could not connect', 'test');
    const error = mapPrismaError(initError, { entityName: 'User', operation: 'findById' });
    expect(error).toBeInstanceOf(ConnectionError);
  });

  it('passes an already-mapped DataAdapterError through unchanged rather than double-wrapping it', () => {
    const original = new EntityNotFoundError('User', 'u-1');
    const result = mapPrismaError(original, { entityName: 'User', operation: 'findById', id: 'u-1' });
    expect(result).toBe(original);
  });

  it('maps a completely unexpected error to ValidationError with its message preserved', () => {
    const error = mapPrismaError(new Error('socket hang up'), { entityName: 'User', operation: 'findById' });
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain('socket hang up');
  });

  it('maps a non-Error thrown value without crashing', () => {
    const error = mapPrismaError('a plain string was thrown', { entityName: 'User', operation: 'findById' });
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain('a plain string was thrown');
  });

  it('every mapped error is an instance of the shared DataAdapterError base', () => {
    const error = mapPrismaError(knownRequestError('P2002'), { entityName: 'User', operation: 'create' });
    expect(error).toBeInstanceOf(DataAdapterError);
  });
});
