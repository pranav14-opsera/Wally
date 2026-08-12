import type { Redis } from 'ioredis';

import type { IRedisClient } from '../../src/adapters/redis/interfaces/IRedisClient.js';

/**
 * Compile-only verification (WO-031), same purpose and mechanism as
 * cloud-interfaces.type-test.ts — this file is never executed by any
 * test runner (`npm run test:types`/tsc is the actual check). Unlike
 * that file (which proves IRedisClient-shaped literals are
 * implementable), this one proves the inverse and more important
 * direction: a REAL `ioredis.Redis` instance is assignable to
 * `IRedisClient` with no adapter/wrapper glue, no cast. If ioredis ever
 * changed its `set`/`multi`/`exec` overloads in a way that broke this
 * assignability, `tsc` would fail here — src/agents/** would otherwise
 * only discover the mismatch by the concrete adapter (WO-030's
 * RedisConnectionFactory) failing at a call site far from this
 * interface's definition.
 */
export function assertRealIoredisSatisfiesIRedisClient(client: Redis): IRedisClient {
  return client;
}
