import type { Logger } from 'pino';

import type { IRedisClient } from '../adapters/redis/interfaces/IRedisClient.js';
import { StepSerializationError, TransactionFailedError } from './errors.js';

const KEY_PREFIX = 'memoize:job';

function stepResultKey(jobId: string, stepOrder: number): string {
  return `${KEY_PREFIX}:${jobId}:step:${stepOrder}:result`;
}

function checkpointKey(jobId: string): string {
  return `${KEY_PREFIX}:${jobId}:checkpoint`;
}

function pausedFlagKey(jobId: string): string {
  return `${KEY_PREFIX}:${jobId}:paused`;
}

/** Recursively checks for function values — the one JSON-incompatible type `JSON.stringify` silently drops instead of throwing on (circular references, by contrast, already make `JSON.stringify` throw natively). Bounded by `seen` the same way `checksum.ts`'s deep walk is, so a legitimately-shared (non-circular) reference isn't visited twice needlessly, though correctness here only depends on catching functions, not cycles. */
function containsFunction(value: unknown, seen: Set<object> = new Set()): boolean {
  if (typeof value === 'function') {
    return true;
  }
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  const entries = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  return entries.some((entry) => containsFunction(entry, seen));
}

/**
 * Caches each step's result in Redis, keyed by job + step order, so a
 * resumed job (WO-031) skips re-executing steps that already completed
 * before a crash. `setStepResult` writes the result AND advances the
 * job's checkpoint pointer in a single MULTI/EXEC transaction — per this
 * WO's own constraint, a step is never considered checkpointed unless
 * both commit together; a crash between the step finishing and this
 * method being called simply means the step re-executes on resume
 * (safe, since steps are expected to be idempotent within a job).
 */
export class StepMemoizer {
  public constructor(
    private readonly redis: IRedisClient,
    private readonly ttlSeconds: number,
    private readonly logger: Logger,
    /** Cache-backend SET values over this size still succeed but log a warning (WO-031 edge case). Injected, not a bare literal — zero-hardcoding constraint applies to this threshold the same as the TTL. */
    private readonly largeResultWarnBytes: number,
  ) {
    if (!redis) {
      throw new Error('StepMemoizer requires a redis client — received null/undefined.');
    }
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error(`StepMemoizer requires a positive integer ttlSeconds — received ${ttlSeconds}.`);
    }
    if (!logger) {
      throw new Error('StepMemoizer requires a logger — received null/undefined.');
    }
    if (!Number.isInteger(largeResultWarnBytes) || largeResultWarnBytes <= 0) {
      throw new Error(`StepMemoizer requires a positive integer largeResultWarnBytes — received ${largeResultWarnBytes}.`);
    }
  }

  public async hasStepResult(jobId: string, stepOrder: number): Promise<boolean> {
    return (await this.redis.get(stepResultKey(jobId, stepOrder))) !== null;
  }

  public async getStepResult<T>(jobId: string, stepOrder: number): Promise<T | null> {
    const raw = await this.redis.get(stepResultKey(jobId, stepOrder));
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  /** Serializes `result`, then atomically SETs the step-result key and advances the checkpoint key in one MULTI/EXEC. Throws `StepSerializationError` for a non-JSON-serializable result, `TransactionFailedError` if the transaction is aborted or any queued command within it fails. */
  public async setStepResult(jobId: string, stepOrder: number, result: unknown): Promise<void> {
    const serialized = this.serialize(jobId, stepOrder, result);

    if (serialized.length > this.largeResultWarnBytes) {
      this.logger.warn(
        { jobId, stepOrder, bytes: serialized.length },
        'Step result exceeds the size warning threshold for memoization caching',
      );
    }

    const transaction = this.redis
      .multi()
      .set(stepResultKey(jobId, stepOrder), serialized, 'EX', this.ttlSeconds)
      .set(checkpointKey(jobId), String(stepOrder), 'EX', this.ttlSeconds);

    const execResult = await transaction.exec();
    if (execResult === null) {
      throw new TransactionFailedError(jobId, stepOrder);
    }
    for (const [error] of execResult) {
      if (error) {
        throw new TransactionFailedError(jobId, stepOrder, error);
      }
    }
  }

  /** The highest step order successfully checkpointed for `jobId`, or `null` if none (never ran, or the cache TTL expired since). */
  public async getCheckpoint(jobId: string): Promise<number | null> {
    const raw = await this.redis.get(checkpointKey(jobId));
    return raw === null ? null : Number(raw);
  }

  /** Removes every cached result up to the current checkpoint plus the checkpoint and paused-flag keys — called once a job reaches a terminal state, so a later job reusing the same jobId space (should that ever happen) starts clean. */
  public async clearJobCache(jobId: string): Promise<void> {
    const checkpoint = await this.getCheckpoint(jobId);
    const keys = [checkpointKey(jobId), pausedFlagKey(jobId)];
    if (checkpoint !== null) {
      for (let stepOrder = 0; stepOrder <= checkpoint; stepOrder += 1) {
        keys.push(stepResultKey(jobId, stepOrder));
      }
    }
    await this.redis.del(...keys);
  }

  public async setPaused(jobId: string): Promise<void> {
    await this.redis.set(pausedFlagKey(jobId), '1', 'EX', this.ttlSeconds);
  }

  public async isPaused(jobId: string): Promise<boolean> {
    return (await this.redis.get(pausedFlagKey(jobId))) !== null;
  }

  public async clearPaused(jobId: string): Promise<void> {
    await this.redis.del(pausedFlagKey(jobId));
  }

  private serialize(jobId: string, stepOrder: number, result: unknown): string {
    if (containsFunction(result)) {
      throw new StepSerializationError(jobId, stepOrder, new TypeError('result contains a function value, which JSON.stringify cannot represent'));
    }
    try {
      // undefined has no JSON representation; treated as an explicit
      // null so hasStepResult()/getStepResult() still round-trip it as
      // "this step completed with an empty result" rather than "never ran".
      return JSON.stringify(result === undefined ? null : result);
    } catch (error) {
      throw new StepSerializationError(jobId, stepOrder, error);
    }
  }
}
