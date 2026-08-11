import { describe, expect, it } from 'vitest';

import { createMockFn, createTestId, resetAllMocks } from '../helpers/index.js';

describe('sample', () => {
  it('runs a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });

  it('resolves the shared test helper imports', () => {
    const id = createTestId('sample');
    expect(id.startsWith('sample-')).toBe(true);

    const mockFn = createMockFn<[number], number>((n) => n * 2);
    expect(mockFn(21)).toBe(42);
    expect(mockFn).toHaveBeenCalledWith(21);

    expect(() => resetAllMocks()).not.toThrow();
  });
});
