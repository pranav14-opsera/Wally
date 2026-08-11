/**
 * Equality-match filter for `findMany`/`count`. Kept as `Partial<T>` (no
 * comparison operators) for now — the stub repository only needs exact
 * matching, and richer operators (e.g. Mongoose-style `$gt`/`$in`) are
 * defined when the real Prisma/Mongoose adapters land in later epics,
 * once both engines' actual query capabilities are known.
 */
export type FilterQuery<T> = Partial<T>;

export interface QueryOptions {
  limit?: number;
  offset?: number;
  sort?: Record<string, 'asc' | 'desc'>;
  select?: string[];
}

/** Thrown by IRepository.findById-dependent operations (update/delete) when the entity does not exist. findById itself returns null instead of throwing. */
export class EntityNotFoundError extends Error {
  public constructor(entityName: string, id: string) {
    super(`${entityName} not found: ${id}`);
    this.name = 'EntityNotFoundError';
  }
}

/** Thrown by IRepository.create when a uniqueness constraint would be violated. */
export class DuplicateEntityError extends Error {
  public constructor(entityName: string, conflictingField: string) {
    super(`${entityName} already exists with conflicting ${conflictingField}`);
    this.name = 'DuplicateEntityError';
  }
}

/**
 * `T extends { id: string }`: every entity operated on by a repository is
 * addressed by a string ID (`findById`/`update`/`delete` all take one),
 * so requiring the shape at the interface level catches a missing `id`
 * field at the call site instead of only inside a concrete adapter.
 */
export interface IRepository<T extends { id: string }> {
  create(data: Partial<T>): Promise<T>;
  findById(id: string): Promise<T | null>;
  findMany(filter: FilterQuery<T>, options?: QueryOptions): Promise<T[]>;
  update(id: string, data: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
  count(filter?: FilterQuery<T>): Promise<number>;
}
