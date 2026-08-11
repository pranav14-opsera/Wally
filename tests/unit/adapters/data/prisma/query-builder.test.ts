import { describe, expect, it } from 'vitest';

import { buildOrderBy, buildPaginationArgs, buildWhere } from '../../../../../src/adapters/data/prisma/query-builder.js';
import type { BaseEntity } from '../../../../../src/adapters/data/types.js';

interface Sample extends BaseEntity {
  name: string;
  age: number;
  archived: boolean | null;
}

describe('buildWhere', () => {
  it('returns undefined when no filters are given', () => {
    expect(buildWhere<Sample>(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty filter object', () => {
    expect(buildWhere<Sample>({})).toBeUndefined();
  });

  it('translates eq to { equals }', () => {
    expect(buildWhere<Sample>({ name: { operator: 'eq', value: 'x' } })).toEqual({ name: { equals: 'x' } });
  });

  it('translates ne to { not }', () => {
    expect(buildWhere<Sample>({ name: { operator: 'ne', value: 'x' } })).toEqual({ name: { not: 'x' } });
  });

  it('translates gt/gte/lt/lte to their Prisma equivalents', () => {
    expect(buildWhere<Sample>({ age: { operator: 'gt', value: 5 } })).toEqual({ age: { gt: 5 } });
    expect(buildWhere<Sample>({ age: { operator: 'gte', value: 5 } })).toEqual({ age: { gte: 5 } });
    expect(buildWhere<Sample>({ age: { operator: 'lt', value: 5 } })).toEqual({ age: { lt: 5 } });
    expect(buildWhere<Sample>({ age: { operator: 'lte', value: 5 } })).toEqual({ age: { lte: 5 } });
  });

  it('translates in to { in } with the array value', () => {
    expect(buildWhere<Sample>({ name: { operator: 'in', value: ['a', 'b'] } })).toEqual({
      name: { in: ['a', 'b'] },
    });
  });

  it('translates contains to { contains }', () => {
    expect(buildWhere<Sample>({ name: { operator: 'contains', value: 'sub' } })).toEqual({
      name: { contains: 'sub' },
    });
  });

  it('translates isNull to { equals: null } regardless of any provided value', () => {
    const where = buildWhere<Sample>({ archived: { operator: 'isNull' } });
    expect(where).toEqual({ archived: { equals: null } });
  });

  it('combines multiple field conditions into one where object', () => {
    const where = buildWhere<Sample>({
      name: { operator: 'eq', value: 'Ada' },
      age: { operator: 'gte', value: 18 },
    });
    expect(where).toEqual({ name: { equals: 'Ada' }, age: { gte: 18 } });
  });
});

describe('buildOrderBy', () => {
  it('returns undefined when no sort is given', () => {
    expect(buildOrderBy<Sample>(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty sort object', () => {
    expect(buildOrderBy<Sample>({})).toBeUndefined();
  });

  it('translates a single sort field into a one-element array', () => {
    expect(buildOrderBy<Sample>({ name: 'asc' })).toEqual([{ name: 'asc' }]);
  });

  it('translates multiple sort fields, preserving order', () => {
    expect(buildOrderBy<Sample>({ age: 'desc', name: 'asc' })).toEqual([{ age: 'desc' }, { name: 'asc' }]);
  });
});

describe('buildPaginationArgs', () => {
  it('returns an empty object when no pagination is given', () => {
    expect(buildPaginationArgs(undefined)).toEqual({});
  });

  it('offset mode maps directly to skip/take', () => {
    expect(buildPaginationArgs({ kind: 'offset', offset: 20, limit: 10 })).toEqual({ skip: 20, take: 10 });
  });

  it('cursor mode without a cursor (first page) requests limit + 1 with no skip/cursor', () => {
    expect(buildPaginationArgs({ kind: 'cursor', limit: 10 })).toEqual({ take: 11 });
  });

  it('cursor mode with a cursor requests limit + 1, skip: 1, and the cursor id', () => {
    expect(buildPaginationArgs({ kind: 'cursor', limit: 10, cursor: 'abc-123' })).toEqual({
      take: 11,
      skip: 1,
      cursor: { id: 'abc-123' },
    });
  });
});
