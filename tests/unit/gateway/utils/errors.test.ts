import { describe, expect, it } from 'vitest';

import { AppError } from '../../../../src/gateway/utils/errors.js';

describe('AppError', () => {
  it('carries code, statusCode, and details, and is a real Error instance', () => {
    const details = [{ field: 'name', message: 'Required' }];
    const err = new AppError('bad input', 'VALIDATION_ERROR', 400, details);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('bad input');
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.statusCode).toBe(400);
    expect(err.details).toEqual(details);
    expect(err.name).toBe('AppError');
  });

  it('defaults details to an empty array', () => {
    expect(new AppError('nope', 'NOT_FOUND', 404).details).toEqual([]);
  });
});
