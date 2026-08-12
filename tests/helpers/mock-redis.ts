import { vi } from 'vitest';

import type { IRedisClient, IRedisMultiCommand } from '../../src/adapters/redis/interfaces/IRedisClient.js';

/**
 * A genuinely functional in-memory `IRedisClient` (WO-031) — StepMemoizer
 * tests need real get/set/multi/exec state to exercise cache hit/miss and
 * atomic-checkpoint behavior, not just spy assertions on a `vi.fn()`
 * stub. TTL is tracked but not actively swept (no background timer);
 * `expireNow(key)` lets a test simulate "the TTL already elapsed"
 * deterministically instead of waiting on real or faked timers.
 */
export class FakeRedisClient implements IRedisClient {
  private readonly store = new Map<string, string>();
  public readonly publishMock = vi.fn(async (_channel: string, _message: string) => 0);
  private failNextTransaction = false;

  public async get(key: string): Promise<string | null> {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  public async set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, value);
    return 'OK';
  }

  public async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.store.delete(key)) {
        deleted += 1;
      }
    }
    return deleted;
  }

  public async publish(channel: string, message: string): Promise<number> {
    return this.publishMock(channel, message);
  }

  public multi(): IRedisMultiCommand {
    const operations: Array<() => void> = [];
    const store = this.store;
    const failThisTransaction = this.failNextTransaction;
    this.failNextTransaction = false;

    const command: IRedisMultiCommand = {
      set(key: string, value: string): IRedisMultiCommand {
        operations.push(() => store.set(key, value));
        return command;
      },
      async exec(): Promise<Array<[Error | null, unknown]> | null> {
        if (failThisTransaction) {
          return null;
        }
        for (const operation of operations) {
          operation();
        }
        return operations.map(() => [null, 'OK'] as [Error | null, unknown]);
      },
    };
    return command;
  }

  /** Simulates the next `multi()...exec()` call being aborted (e.g. a watched key changed) — `exec()` resolves `null` without applying any queued command. */
  public failNextTransactionOnce(): void {
    this.failNextTransaction = true;
  }

  /** Simulates TTL expiry for `key` without waiting on real or faked timers. */
  public expireNow(key: string): void {
    this.store.delete(key);
  }

  public hasKey(key: string): boolean {
    return this.store.has(key);
  }
}

export function createMockRedis(): IRedisClient {
  return new FakeRedisClient();
}
