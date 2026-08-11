import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';

import {
  ConnectionError,
  DataAdapterError,
  DuplicateKeyError,
  TransactionError,
  ValidationError,
} from '../../../../../src/adapters/data/errors.js';
import { isMongooseTransactionError, mapMongooseError } from '../../../../../src/adapters/data/mongoose/error-mapper.js';

function serverError(overrides: Record<string, unknown>): mongoose.mongo.MongoServerError {
  return new mongoose.mongo.MongoServerError({ message: 'simulated MongoDB error', ...overrides });
}

describe('mapMongooseError', () => {
  it('maps a duplicate-key MongoServerError (code 11000) to DuplicateKeyError naming the field', () => {
    const error = mapMongooseError(serverError({ code: 11000, keyValue: { email: 'a@example.com' } }), {
      entityName: 'User',
      operation: 'create',
    });
    expect(error).toBeInstanceOf(DuplicateKeyError);
    expect(error.code).toBe('DUPLICATE_KEY');
    expect(error.message).toContain('email');
  });

  it('maps a duplicate-key error with no keyValue gracefully', () => {
    const error = mapMongooseError(serverError({ code: 11000 }), { entityName: 'User', operation: 'create' });
    expect(error).toBeInstanceOf(DuplicateKeyError);
    expect(error.message).toContain('unknown field');
  });

  it('maps a MongoServerError carrying a TransientTransactionError label to TransactionError', () => {
    const error = mapMongooseError(serverError({ code: 112, errorLabels: ['TransientTransactionError'] }), {
      entityName: 'AgentJob',
      operation: 'transaction',
    });
    expect(error).toBeInstanceOf(TransactionError);
  });

  it('maps an unrecognized MongoServerError code to ValidationError, preserving the code and message', () => {
    const error = mapMongooseError(serverError({ code: 999 }), { entityName: 'User', operation: 'create' });
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain('999');
  });

  it('maps a Mongoose ValidationError to the shared ValidationError', () => {
    const original = new mongoose.Error.ValidationError();
    const error = mapMongooseError(original, { entityName: 'User', operation: 'create' });
    expect(error).toBeInstanceOf(ValidationError);
  });

  it('maps a Mongoose CastError (e.g. malformed id) to ValidationError', () => {
    const original = new mongoose.Error.CastError('String', 'not-an-id', 'user_id');
    const error = mapMongooseError(original, { entityName: 'AgentJob', operation: 'findById' });
    expect(error).toBeInstanceOf(ValidationError);
  });

  it('passes an already-mapped DataAdapterError through unchanged rather than double-wrapping it', () => {
    const original = new DuplicateKeyError('User', 'email');
    const result = mapMongooseError(original, { entityName: 'User', operation: 'create' });
    expect(result).toBe(original);
  });

  it('maps a completely unexpected error to ValidationError with its message preserved', () => {
    const error = mapMongooseError(new Error('socket hang up'), { entityName: 'User', operation: 'findById' });
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain('socket hang up');
  });

  it('maps a non-Error thrown value without crashing', () => {
    const error = mapMongooseError('a plain string was thrown', { entityName: 'User', operation: 'findById' });
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain('a plain string was thrown');
  });

  it('every mapped error is an instance of the shared DataAdapterError base', () => {
    const error = mapMongooseError(serverError({ code: 11000 }), { entityName: 'User', operation: 'create' });
    expect(error).toBeInstanceOf(DataAdapterError);
  });
});

describe('isMongooseTransactionError', () => {
  it('returns true for TransientTransactionError', () => {
    expect(isMongooseTransactionError(serverError({ errorLabels: ['TransientTransactionError'] }))).toBe(true);
  });

  it('returns true for UnknownTransactionCommitResult', () => {
    expect(isMongooseTransactionError(serverError({ errorLabels: ['UnknownTransactionCommitResult'] }))).toBe(true);
  });

  it('returns false for an error with no labels', () => {
    expect(isMongooseTransactionError(serverError({ code: 11000 }))).toBe(false);
  });

  it('returns false for a non-object error', () => {
    expect(isMongooseTransactionError('not an error')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isMongooseTransactionError(null)).toBe(false);
  });

  it('returns false for a ConnectionError instance (no errorLabels property at all)', () => {
    expect(isMongooseTransactionError(new ConnectionError('unreachable'))).toBe(false);
  });
});
