import { Prisma } from '../../../generated/prisma/client.js';
import {
  ConnectionError,
  DataAdapterError,
  DuplicateKeyError,
  EntityNotFoundError,
  ForeignKeyViolationError,
  ValidationError,
} from '../errors.js';

export interface PrismaErrorContext {
  entityName: string;
  operation: string;
  /** The `id` the operation targeted, when known — used to produce an accurate EntityNotFoundError. */
  id?: string;
}

/**
 * True for errors that genuinely originated from Prisma/the database
 * driver. Used by `PrismaRepository.transaction()` to decide whether an
 * error escaping its callback should be normalized via `mapPrismaError`
 * (a real driver failure) or rethrown unchanged (arbitrary application
 * code the caller threw to trigger a rollback) — Prisma's own
 * `$transaction` preserves callback errors verbatim, and callers may
 * depend on catching their own specific error type afterward.
 */
export function isPrismaDriverError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientInitializationError;
}

function formatUniqueConstraintTarget(meta: Record<string, unknown> | undefined): string {
  const target = meta?.target;
  if (Array.isArray(target)) {
    return target.join(', ');
  }
  return typeof target === 'string' ? target : 'unknown field';
}

function formatForeignKeyField(meta: Record<string, unknown> | undefined): string {
  const fieldName = meta?.field_name;
  return typeof fieldName === 'string' ? fieldName : 'unknown field';
}

/**
 * Normalizes any error a Prisma delegate call can throw into the shared
 * `DataAdapterError` hierarchy (src/adapters/data/errors.ts) so callers
 * never branch on driver-specific exceptions. If `error` is already a
 * `DataAdapterError` (e.g. rethrown from a nested call), it passes
 * through unchanged rather than being double-wrapped.
 */
export function mapPrismaError(error: unknown, context: PrismaErrorContext): DataAdapterError {
  if (error instanceof DataAdapterError) {
    return error;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P1xxx = connection-level failures; P2xxx = query/constraint failures.
    if (error.code.startsWith('P1')) {
      return new ConnectionError(
        `Database connection error (${error.code}) during ${context.operation} on ${context.entityName}: ${error.message}`,
      );
    }

    const meta = error.meta as Record<string, unknown> | undefined;
    switch (error.code) {
      case 'P2002':
        return new DuplicateKeyError(context.entityName, formatUniqueConstraintTarget(meta));
      case 'P2025':
        return new EntityNotFoundError(context.entityName, context.id ?? 'unknown');
      case 'P2003':
        return new ForeignKeyViolationError(context.entityName, formatForeignKeyField(meta));
      default:
        return new ValidationError(
          `Prisma error ${error.code} during ${context.operation} on ${context.entityName}: ${error.message}`,
        );
    }
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return new ConnectionError(
      `Failed to connect to the database for ${context.operation} on ${context.entityName}: ${error.message}`,
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  return new ValidationError(`Unexpected error during ${context.operation} on ${context.entityName}: ${message}`);
}
