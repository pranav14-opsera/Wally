import { vi } from 'vitest';
import type { Mock } from 'vitest';

/**
 * Wraps `vi.fn()` with an explicit generic signature so mocked functions
 * keep their real call/return types instead of collapsing to `any`.
 */
export function createMockFn<TArgs extends unknown[], TReturn>(
  implementation?: (...args: TArgs) => TReturn,
): Mock<TArgs, TReturn> {
  return implementation ? vi.fn(implementation) : vi.fn<TArgs, TReturn>();
}

/**
 * Restores all mocks (spies, mocked implementations, and auto-mocked
 * modules) to their original, unmocked state. Call in an `afterEach` to
 * keep mock state from leaking between tests.
 */
export function resetAllMocks(): void {
  vi.restoreAllMocks();
}

/**
 * Generates a unique identifier for use in test fixtures, so parallel
 * tests never collide on hardcoded IDs.
 */
export function createTestId(prefix = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
