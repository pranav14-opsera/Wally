import type { BaseEntity, FilterCondition, FilterOptions, PaginationOptions, SortOptions } from '../types.js';

export type MongooseQuery = Record<string, unknown>;
export type MongooseSort = Record<string, 1 | -1>;

/** Escapes regex metacharacters so a `contains` filter value is matched literally, not interpreted as a pattern — untrusted input must never reach `$regex` unescaped (ReDoS / unintended-match risk). */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFieldQuery<TValue>(condition: FilterCondition<TValue>): unknown {
  switch (condition.operator) {
    case 'eq':
      return { $eq: condition.value };
    case 'ne':
      return { $ne: condition.value };
    case 'gt':
      return { $gt: condition.value };
    case 'gte':
      return { $gte: condition.value };
    case 'lt':
      return { $lt: condition.value };
    case 'lte':
      return { $lte: condition.value };
    case 'in':
      return { $in: condition.value };
    case 'contains':
      return { $regex: escapeRegExp(String(condition.value)), $options: 'i' };
    case 'isNull':
      return { $eq: null };
    default:
      // Exhaustiveness guard — see the identical pattern in the Prisma
      // query-builder (WO-009) for why this throws instead of building a
      // silent no-op filter.
      throw new Error(`Unhandled filter operator: ${String((condition as FilterCondition<unknown>).operator)}`);
  }
}

/** Translates `FilterOptions<T>` (WO-007) into a Mongoose/MongoDB query object. */
export function buildQuery<T extends BaseEntity>(filters?: FilterOptions<T>): MongooseQuery {
  if (!filters) {
    return {};
  }

  const query: MongooseQuery = {};
  for (const key of Object.keys(filters) as Array<keyof T>) {
    const condition = filters[key];
    if (condition) {
      const field = key === 'id' ? '_id' : (key as string);
      query[field] = buildFieldQuery(condition);
    }
  }
  return query;
}

/** Translates `SortOptions<T>` (WO-007) into a Mongoose sort object. Defaults to `_id: 1` when no sort is given, so cursor pagination always has a deterministic, stable order to page through. */
export function buildSort<T extends BaseEntity>(sort?: SortOptions<T>): MongooseSort {
  const entries = Object.entries(sort ?? {}) as Array<[string, 'asc' | 'desc']>;
  if (entries.length === 0) {
    return { _id: 1 };
  }
  const mongoSort: MongooseSort = {};
  for (const [field, direction] of entries) {
    mongoSort[field === 'id' ? '_id' : field] = direction === 'asc' ? 1 : -1;
  }
  return mongoSort;
}

/** The primary sort field driving cursor pagination's `$gt`/`$lt` comparison — the first entry of `buildSort`'s result. */
export function primarySortField(sort: MongooseSort): { field: string; direction: 1 | -1 } {
  const [field, direction] = Object.entries(sort)[0] ?? ['_id', 1];
  return { field, direction: direction as 1 | -1 };
}

export interface MongoosePaginationPlan {
  skip?: number;
  limit: number;
  /** Extra `$and`-ed query clause implementing the cursor, when in cursor mode with a cursor value. */
  cursorQuery?: MongooseQuery;
}

/**
 * Translates `PaginationOptions` (WO-007) into a skip/limit plan. `limit`
 * is always requested as one more than asked for — the standard
 * over-fetch-by-one technique (same as the Prisma adapter, WO-009) lets
 * the repository detect "is there a next page" without a second query,
 * and works identically for both offset and cursor modes.
 *
 * Cursor mode compares only the primary sort field (`cursorValue`) plus
 * `_id` as a tiebreaker for correctness when that field has duplicate
 * values — genuinely correct compound-cursor pagination across *all*
 * sort fields would need a chained `$or`, which isn't implemented here;
 * multi-field sorts combined with cursor pagination may repeat or skip
 * entries at ties on non-primary fields. Disclosed limitation, not a bug
 * to silently paper over.
 */
export function buildPaginationPlan(
  pagination: PaginationOptions | undefined,
  sort: MongooseSort,
  cursorValue: unknown,
  cursorId: string | undefined,
): MongoosePaginationPlan {
  if (!pagination) {
    return { limit: Number.MAX_SAFE_INTEGER };
  }

  if (pagination.kind === 'offset') {
    return { skip: pagination.offset, limit: pagination.limit + 1 };
  }

  if (!pagination.cursor) {
    return { limit: pagination.limit + 1 };
  }

  const { field, direction } = primarySortField(sort);
  const comparisonOp = direction === 1 ? '$gt' : '$lt';
  const cursorQuery: MongooseQuery = {
    $or: [
      { [field]: { [comparisonOp]: cursorValue } },
      { [field]: cursorValue, _id: { [comparisonOp]: cursorId } },
    ],
  };

  return { limit: pagination.limit + 1, cursorQuery };
}
