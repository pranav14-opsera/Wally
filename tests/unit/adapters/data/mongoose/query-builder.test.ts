import { describe, expect, it } from 'vitest';

import {
  buildPaginationPlan,
  buildQuery,
  buildSort,
  primarySortField,
} from '../../../../../src/adapters/data/mongoose/query-builder.js';
import type { BaseEntity } from '../../../../../src/adapters/data/types.js';

interface Sample extends BaseEntity {
  name: string;
  age: number;
}

describe('buildQuery', () => {
  it('returns an empty object when no filters are given', () => {
    expect(buildQuery<Sample>(undefined)).toEqual({});
  });

  it('maps eq/ne/gt/gte/lt/lte to their Mongo operators', () => {
    expect(buildQuery<Sample>({ name: { operator: 'eq', value: 'Ada' } })).toEqual({ name: { $eq: 'Ada' } });
    expect(buildQuery<Sample>({ name: { operator: 'ne', value: 'Ada' } })).toEqual({ name: { $ne: 'Ada' } });
    expect(buildQuery<Sample>({ age: { operator: 'gt', value: 5 } })).toEqual({ age: { $gt: 5 } });
    expect(buildQuery<Sample>({ age: { operator: 'gte', value: 5 } })).toEqual({ age: { $gte: 5 } });
    expect(buildQuery<Sample>({ age: { operator: 'lt', value: 5 } })).toEqual({ age: { $lt: 5 } });
    expect(buildQuery<Sample>({ age: { operator: 'lte', value: 5 } })).toEqual({ age: { $lte: 5 } });
  });

  it('maps in to $in with the array value', () => {
    expect(buildQuery<Sample>({ name: { operator: 'in', value: ['a', 'b'] } })).toEqual({ name: { $in: ['a', 'b'] } });
  });

  it('maps isNull to { $eq: null }', () => {
    expect(buildQuery<Sample>({ name: { operator: 'isNull' } })).toEqual({ name: { $eq: null } });
  });

  it('maps contains to a case-insensitive $regex', () => {
    expect(buildQuery<Sample>({ name: { operator: 'contains', value: 'da' } })).toEqual({
      name: { $regex: 'da', $options: 'i' },
    });
  });

  it('escapes regex metacharacters in a contains value so they match literally', () => {
    const query = buildQuery<Sample>({ name: { operator: 'contains', value: 'a.b*c' } });
    expect(query).toEqual({ name: { $regex: 'a\\.b\\*c', $options: 'i' } });
  });

  it('maps the id field to _id', () => {
    expect(buildQuery<Sample>({ id: { operator: 'eq', value: 'x-1' } })).toEqual({ _id: { $eq: 'x-1' } });
  });

  it('combines multiple field conditions', () => {
    expect(
      buildQuery<Sample>({ name: { operator: 'eq', value: 'Ada' }, age: { operator: 'gte', value: 18 } }),
    ).toEqual({ name: { $eq: 'Ada' }, age: { $gte: 18 } });
  });
});

describe('buildSort', () => {
  it('defaults to { _id: 1 } when no sort is given', () => {
    expect(buildSort<Sample>(undefined)).toEqual({ _id: 1 });
  });

  it('defaults to { _id: 1 } for an empty sort object', () => {
    expect(buildSort<Sample>({})).toEqual({ _id: 1 });
  });

  it('translates asc/desc to 1/-1', () => {
    expect(buildSort<Sample>({ name: 'asc', age: 'desc' })).toEqual({ name: 1, age: -1 });
  });

  it('maps the id field to _id', () => {
    expect(buildSort<Sample>({ id: 'asc' })).toEqual({ _id: 1 });
  });
});

describe('primarySortField', () => {
  it('returns the first field/direction pair', () => {
    expect(primarySortField({ age: -1, name: 1 })).toEqual({ field: 'age', direction: -1 });
  });

  it('defaults to _id/1 for an empty sort object', () => {
    expect(primarySortField({})).toEqual({ field: '_id', direction: 1 });
  });
});

describe('buildPaginationPlan', () => {
  const SORT = { _id: 1 as const };

  it('returns an unbounded plan when no pagination is given', () => {
    const plan = buildPaginationPlan(undefined, SORT, undefined, undefined);
    expect(plan.skip).toBeUndefined();
    expect(plan.cursorQuery).toBeUndefined();
    expect(plan.limit).toBeGreaterThan(0);
  });

  it('offset mode maps to skip/limit+1 (over-fetch by one)', () => {
    const plan = buildPaginationPlan({ kind: 'offset', offset: 20, limit: 10 }, SORT, undefined, undefined);
    expect(plan).toEqual({ skip: 20, limit: 11 });
  });

  it('cursor mode without a cursor (first page) has no cursorQuery, requests limit+1', () => {
    const plan = buildPaginationPlan({ kind: 'cursor', limit: 10 }, SORT, undefined, undefined);
    expect(plan.cursorQuery).toBeUndefined();
    expect(plan.limit).toBe(11);
  });

  it('cursor mode with a cursor builds an $or clause comparing the primary sort field and _id tiebreaker', () => {
    const plan = buildPaginationPlan({ kind: 'cursor', limit: 10, cursor: 'abc' }, { age: 1 }, 30, 'abc');
    expect(plan.limit).toBe(11);
    expect(plan.cursorQuery).toEqual({
      $or: [{ age: { $gt: 30 } }, { age: 30, _id: { $gt: 'abc' } }],
    });
  });

  it('cursor mode respects a descending primary sort direction ($lt instead of $gt)', () => {
    const plan = buildPaginationPlan({ kind: 'cursor', limit: 10, cursor: 'abc' }, { age: -1 }, 30, 'abc');
    expect(plan.cursorQuery).toEqual({
      $or: [{ age: { $lt: 30 } }, { age: 30, _id: { $lt: 'abc' } }],
    });
  });
});
