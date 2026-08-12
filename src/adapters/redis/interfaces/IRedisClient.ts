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
 * WO-031 (step memoization/crash-resume) is the first real consumer:
 * `get`/`set` (with the `'EX'` TTL form, matching ioredis's own overload
 * so a real client satisfies this with no adapter glue) for the
 * memoization cache, `multi` for the atomic step-result + checkpoint
 * write. `publish` remains for WO-033 (SSE progress publishing), still
 * unused by BaseAgent itself.
 */
export interface IRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<'OK'>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<'OK'>;
  del(...keys: string[]): Promise<number>;
  publish(channel: string, message: string): Promise<number>;
  /** Starts a MULTI transaction — `exec()` resolves `null` if the transaction was aborted (e.g. a watched key changed) rather than committed, per ioredis's own contract. */
  multi(): IRedisMultiCommand;
}

export interface IRedisMultiCommand {
  set(key: string, value: string): this;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): this;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}
