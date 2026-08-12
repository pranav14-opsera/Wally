import { describe, expect, it } from 'vitest';

import { error, paginated, success } from '../../../../src/gateway/utils/response.js';

describe('success', () => {
  it('wraps data with success: true and the given requestId', () => {
    expect(success({ id: 1 }, 'req-1')).toEqual({ success: true, data: { id: 1 }, requestId: 'req-1' });
  });

  it('includes meta when provided', () => {
    const meta = paginated(1, 20, 45);
    expect(success([1, 2], 'req-2', meta)).toEqual({ success: true, data: [1, 2], meta, requestId: 'req-2' });
  });

  it('omits the meta field entirely when not provided (not meta: undefined)', () => {
    expect(Object.keys(success({}, 'req-3'))).not.toContain('meta');
  });
});

describe('error', () => {
  it('wraps an error with success: false, code, message, and requestId', () => {
    expect(error('NOT_FOUND', 'missing', 'req-4')).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'missing', details: [] },
      requestId: 'req-4',
    });
  });

  it('includes an empty details array by default (edge case: no details still present)', () => {
    expect(error('INTERNAL_ERROR', 'boom', 'req-5').error.details).toEqual([]);
  });

  it('carries field-level details when provided', () => {
    const details = [{ field: 'email', message: 'Invalid email' }];
    expect(error('VALIDATION_ERROR', 'invalid', 'req-6', details).error.details).toEqual(details);
  });
});

describe('paginated', () => {
  it('computes totalPages by ceiling division', () => {
    expect(paginated(1, 20, 45)).toEqual({ page: 1, limit: 20, total: 45, totalPages: 3 });
  });

  it('returns totalPages: 0 for an empty result set (edge case)', () => {
    expect(paginated(1, 20, 0)).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
  });

  it('returns correct meta for a page beyond the last page (edge case)', () => {
    expect(paginated(99, 20, 45)).toEqual({ page: 99, limit: 20, total: 45, totalPages: 3 });
  });
});
