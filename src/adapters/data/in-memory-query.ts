import type { BaseEntity, FilterCondition, FilterOptions, PaginationOptions, SortOptions } from './types.js';

/**
 * Pure in-memory implementations of `FilterOptions`/`SortOptions`/
 * `PaginationOptions` (WO-007) — the single source of truth for what
 * those semantics mean, shared by `StubRepository` (the whole entity
 * set) and the Mongoose adapter's embedded-array repositories
 * (WO-011, one AgentJob's `job_steps`/`drift_events` array). Both need
 * *identical* filter/sort/pagination behavior per REQ-002's cross-engine
 * parity requirement — two independently-written copies would risk
 * subtle behavioral drift between them.
 */

export function matchesCondition<TValue>(actual: TValue, condition: FilterCondition<TValue>): boolean {
  switch (condition.operator) {
    case 'eq':
      return actual === condition.value;
    case 'ne':
      return actual !== condition.value;
    case 'gt':
      return actual !== null && actual !== undefined && actual > (condition.value as TValue);
    case 'gte':
      return actual !== null && actual !== undefined && actual >= (condition.value as TValue);
    case 'lt':
      return actual !== null && actual !== undefined && actual < (condition.value as TValue);
    case 'lte':
      return actual !== null && actual !== undefined && actual <= (condition.value as TValue);
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(actual);
    case 'contains':
      return typeof actual === 'string' && typeof condition.value === 'string'
        ? actual.includes(condition.value)
        : false;
    case 'isNull':
      return actual === null || actual === undefined;
    default:
      return false;
  }
}

export function matchesFilter<T extends BaseEntity>(entity: T, filters: FilterOptions<T>): boolean {
  return (Object.keys(filters) as Array<keyof T>).every((key) => {
    const condition = filters[key];
    if (!condition) {
      return true;
    }
    return matchesCondition(entity[key], condition);
  });
}

export function applySort<T extends BaseEntity>(entities: T[], sort: SortOptions<T> | undefined): T[] {
  if (!sort) {
    return entities;
  }

  const sortEntries = Object.entries(sort) as Array<[keyof T, 'asc' | 'desc']>;
  if (sortEntries.length === 0) {
    return entities;
  }

  return [...entities].sort((a, b) => {
    for (const [field, direction] of sortEntries) {
      const aValue = a[field];
      const bValue = b[field];
      if (aValue === bValue) {
        continue;
      }
      const comparison = aValue < bValue ? -1 : 1;
      return direction === 'desc' ? -comparison : comparison;
    }
    return 0;
  });
}

export function applyPagination<T extends BaseEntity>(
  entities: T[],
  pagination: PaginationOptions | undefined,
): { page: T[]; hasNext: boolean; nextCursor?: string } {
  if (!pagination) {
    return { page: entities, hasNext: false };
  }

  if (pagination.kind === 'offset') {
    const page = entities.slice(pagination.offset, pagination.offset + pagination.limit);
    const hasNext = pagination.offset + page.length < entities.length;
    return { page, hasNext };
  }

  // cursor pagination: the cursor is the id of the last item seen.
  const startIndex = pagination.cursor
    ? entities.findIndex((entity) => entity.id === pagination.cursor) + 1
    : 0;
  const page = entities.slice(startIndex, startIndex + pagination.limit);
  const hasNext = startIndex + page.length < entities.length;
  const nextCursor = hasNext ? page[page.length - 1]?.id : undefined;
  return { page, hasNext, nextCursor };
}
