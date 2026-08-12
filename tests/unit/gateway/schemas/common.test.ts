import { describe, expect, it } from 'vitest';

import { paginationQuerySchema, sortQuerySchema, uuidParamsSchema } from '../../../../src/gateway/schemas/common.js';

describe('paginationQuerySchema', () => {
  it('coerces string query values to numbers', () => {
    expect(paginationQuerySchema.parse({ page: '3', limit: '50' })).toEqual({ page: 3, limit: 50 });
  });

  it('defaults page to 1 and limit to 20', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it('rejects a limit above 100', () => {
    expect(() => paginationQuerySchema.parse({ limit: '101' })).toThrow();
  });

  it('rejects a non-positive page', () => {
    expect(() => paginationQuerySchema.parse({ page: '0' })).toThrow();
  });
});

describe('uuidParamsSchema', () => {
  it('accepts a valid UUID', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    expect(uuidParamsSchema.parse({ id })).toEqual({ id });
  });

  it('rejects a non-UUID string', () => {
    expect(() => uuidParamsSchema.parse({ id: 'nope' })).toThrow();
  });
});

describe('sortQuerySchema', () => {
  it('defaults sortOrder to asc', () => {
    expect(sortQuerySchema.parse({})).toEqual({ sortOrder: 'asc' });
  });

  it('accepts desc', () => {
    expect(sortQuerySchema.parse({ sortOrder: 'desc' })).toEqual({ sortOrder: 'desc' });
  });

  it('rejects an invalid sortOrder', () => {
    expect(() => sortQuerySchema.parse({ sortOrder: 'sideways' })).toThrow();
  });
});
