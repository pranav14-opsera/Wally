/**
 * Every persisted entity is addressed by a string ID and carries
 * created_at/updated_at — required uniformly so `IRepository<T>` can stay
 * a single generic interface instead of one per entity shape. A handful
 * of entities are write-once in the real schema (e.g. AuditLog,
 * SpecRegistryEntry) and won't have a genuinely *changing* updated_at,
 * but concrete adapters (WO-008 Prisma, WO-010 Mongoose) can simply set
 * it equal to created_at at write time for those — see the "Database
 * Schema Analysis" architecture artifact for the entity-by-entity column
 * lists this was derived from.
 */
export interface BaseEntity {
  id: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * `isNull` is a dedicated operator rather than allowing `null` as an
 * `eq` value — keeps null-checks explicit and type-safe instead of
 * relying on a magic sentinel value (WO-007 edge case).
 */
export type QueryOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'isNull';

export interface FilterCondition<TValue> {
  operator: QueryOperator;
  /** Required for every operator except 'isNull'; an array for 'in'. */
  value?: TValue | TValue[];
}

export type FilterOptions<T> = {
  [K in keyof T]?: FilterCondition<T[K]>;
};

export type SortDirection = 'asc' | 'desc';

export type SortOptions<T> = {
  [K in keyof T]?: SortDirection;
};

export interface OffsetPagination {
  kind: 'offset';
  limit: number;
  offset: number;
}

export interface CursorPagination {
  kind: 'cursor';
  limit: number;
  cursor?: string;
}

/** Union, not a single shape with optional fields — callers pick one
 * pagination strategy per call, they don't mix cursor and offset. */
export type PaginationOptions = OffsetPagination | CursorPagination;

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  hasNext: boolean;
  /** Present only when the result was produced from cursor pagination. */
  nextCursor?: string;
}

export interface TransactionContext {
  readonly id: string;
}
