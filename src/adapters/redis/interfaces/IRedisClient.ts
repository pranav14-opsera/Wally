/**
 * Structural contract for the Redis client BaseAgent (and its
 * subclasses) depend on — deliberately not the `ioredis` package's own
 * `Redis` type, per the zero-hardcoding lint rule (`src/agents/**` may
 * only import adapter interfaces, never a concrete provider SDK). A real
 * `ioredis.Redis` instance satisfies this interface structurally without
 * agent code ever importing `ioredis` itself; the concrete adapter that
 * constructs one is WO-030's scope (BullMQ Queues and Redis Connection
 * Management).
 *
 * Only the handful of primitives BaseAgent's known future consumers need
 * are declared here: WO-031 (step memoization/crash-resume) reads/writes
 * a value by key, WO-033 (SSE progress publishing) publishes to a
 * channel. Neither is called by BaseAgent itself yet (WO-029) — this
 * interface exists so the constructor's dependency-injection point
 * doesn't need a breaking change when either lands.
 */
export interface IRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<'OK'>;
  publish(channel: string, message: string): Promise<number>;
}
