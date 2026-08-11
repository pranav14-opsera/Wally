/** Programmatic error codes — pair with `instanceof` checks for callers that need to branch on failure type without string-matching messages. */
export type DataErrorCode =
  | 'ENTITY_NOT_FOUND'
  | 'DUPLICATE_KEY'
  | 'VALIDATION'
  | 'TRANSACTION'
  | 'CONNECTION';

/**
 * Base class for every error an `IRepository<T>` implementation throws.
 * Both the Prisma and Mongoose adapters (WO-008/WO-010+) must normalize
 * their driver-specific exceptions into one of these subclasses so
 * consumers handle errors identically regardless of DATA_ENGINE.
 */
export class DataAdapterError extends Error {
  public constructor(
    message: string,
    public readonly code: DataErrorCode,
  ) {
    super(message);
    this.name = 'DataAdapterError';
  }
}

/** Thrown by update/delete when the target entity does not exist. `findById` returns null instead of throwing. */
export class EntityNotFoundError extends DataAdapterError {
  public constructor(entityName: string, id: string) {
    super(`${entityName} not found: ${id}`, 'ENTITY_NOT_FOUND');
    this.name = 'EntityNotFoundError';
  }
}

/** Thrown by create/createMany when a uniqueness constraint would be violated. */
export class DuplicateKeyError extends DataAdapterError {
  public constructor(entityName: string, conflictingField: string) {
    super(`${entityName} already exists with conflicting ${conflictingField}`, 'DUPLICATE_KEY');
    this.name = 'DuplicateKeyError';
  }
}

/** Thrown when input data fails a repository-level validation check before it would reach the database. */
export class ValidationError extends DataAdapterError {
  public constructor(message: string) {
    super(message, 'VALIDATION');
    this.name = 'ValidationError';
  }
}

/** Thrown by `transaction()` on commit/rollback failure, or when a nested transaction is attempted. */
export class TransactionError extends DataAdapterError {
  public constructor(message: string) {
    super(message, 'TRANSACTION');
    this.name = 'TransactionError';
  }
}

/** Thrown when the underlying database connection cannot be established or is lost mid-operation. */
export class ConnectionError extends DataAdapterError {
  public constructor(message: string) {
    super(message, 'CONNECTION');
    this.name = 'ConnectionError';
  }
}
