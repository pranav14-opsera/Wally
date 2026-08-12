import { vi } from 'vitest';

import type { IRedisClient } from '../../src/adapters/redis/interfaces/IRedisClient.js';

/**
 * BaseAgent (WO-029) accepts an `IRedisClient` via constructor injection
 * but doesn't call any method on it yet — step memoization (WO-031) and
 * SSE progress publishing (WO-033) are the first real consumers. This
 * fake only needs to be a truthy, correctly-shaped object so the
 * constructor's null/undefined guard and TypeScript's structural typing
 * are satisfied.
 */
export function createMockRedis(): IRedisClient {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK' as const),
    publish: vi.fn(async () => 0),
  };
}
