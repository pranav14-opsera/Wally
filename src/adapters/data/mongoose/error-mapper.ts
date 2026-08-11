import mongoose from 'mongoose';

import { ConnectionError, DataAdapterError, DuplicateKeyError, TransactionError, ValidationError } from '../errors.js';

const DUPLICATE_KEY_CODE = 11000;
// MongoDB error labels present on genuinely transaction-related failures
// (transient conflicts, unknown commit results) — used to distinguish
// "this transaction attempt failed" from an ordinary query error that
// merely happened to occur inside a session.
const TRANSACTION_ERROR_LABELS = ['TransientTransactionError', 'UnknownTransactionCommitResult'];

export interface MongooseErrorContext {
  entityName: string;
  operation: string;
}

function formatDuplicateKeyFields(error: mongoose.mongo.MongoServerError): string {
  const keyValue = error.keyValue as Record<string, unknown> | undefined;
  const fields = keyValue ? Object.keys(keyValue) : [];
  return fields.length > 0 ? fields.join(', ') : 'unknown field';
}

function hasErrorLabel(error: unknown, label: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'errorLabels' in error &&
    Array.isArray((error as { errorLabels: unknown }).errorLabels) &&
    ((error as { errorLabels: unknown[] }).errorLabels as unknown[]).includes(label)
  );
}

/**
 * True for MongoServerErrors carrying a transaction-specific error label
 * — used by `MongooseRepository.transaction()` to decide whether an
 * error escaping the callback should be normalized (a genuine
 * transaction failure) or rethrown unchanged (arbitrary application
 * code the caller threw for its own reasons) — mirrors
 * `isPrismaDriverError` in the Prisma adapter (WO-009) for the identical
 * reason: a caller must still be able to catch its own error types after
 * a rolled-back transaction.
 */
export function isMongooseTransactionError(error: unknown): boolean {
  return TRANSACTION_ERROR_LABELS.some((label) => hasErrorLabel(error, label));
}

/**
 * Normalizes any error a Mongoose model call can throw into the shared
 * `DataAdapterError` hierarchy (src/adapters/data/errors.ts). Unlike
 * Prisma, Mongoose's `findByIdAndUpdate`/`findByIdAndDelete` return
 * `null` rather than throwing on a missing record — `MongooseRepository`
 * checks for that itself and throws `EntityNotFoundError` directly,
 * so no not-found case appears here.
 */
export function mapMongooseError(error: unknown, context: MongooseErrorContext): DataAdapterError {
  if (error instanceof DataAdapterError) {
    return error;
  }

  if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError) {
    return new ValidationError(
      `Validation failed during ${context.operation} on ${context.entityName}: ${error.message}`,
    );
  }

  if (error instanceof mongoose.mongo.MongoServerError) {
    if (error.code === DUPLICATE_KEY_CODE) {
      return new DuplicateKeyError(context.entityName, formatDuplicateKeyFields(error));
    }
    if (isMongooseTransactionError(error)) {
      return new TransactionError(
        `Transaction error during ${context.operation} on ${context.entityName}: ${error.message}`,
      );
    }
    return new ValidationError(
      `MongoDB error (${error.code ?? 'unknown'}) during ${context.operation} on ${context.entityName}: ${error.message}`,
    );
  }

  if (error instanceof mongoose.mongo.MongoNetworkError) {
    return new ConnectionError(
      `Database connection error during ${context.operation} on ${context.entityName}: ${error.message}`,
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  return new ValidationError(`Unexpected error during ${context.operation} on ${context.entityName}: ${message}`);
}
