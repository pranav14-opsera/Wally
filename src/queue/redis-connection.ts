import { Redis } from 'ioredis';
import type { RedisOptions } from 'ioredis';
import type { Logger } from 'pino';

import { getConfig } from '../config/index.js';
import { RedisConfigurationError } from './errors.js';

const HEALTH_CHECK_TIMEOUT_MS = 2_000;
const CLOSE_ALL_TIMEOUT_MS = 5_000;

export interface RedisHealthStatus {
  status: 'ok' | 'degraded' | 'down';
  latencyMs: number | null;
  /** Count of connections this factory instance currently manages — not the Redis server's own CLIENT LIST count. */
  connectedClients: number;
}

/**
 * Creates and owns every `ioredis.Redis` connection this process uses.
 * Redis serves three roles in Wally (job queue, step memoization, SSE
 * pub/sub) — each gets its own connection, keyed by a caller-supplied
 * `purpose` string, per BullMQ's own guidance that Queue (publisher) and
 * Worker (subscriber) connections must not be shared.
 */
export class RedisConnectionFactory {
  private readonly connections = new Map<string, Redis>();

  public constructor(private readonly logger: Logger) {}

  /** Returns the existing connection for `purpose` if one was already created, otherwise builds and caches a new one. */
  public createConnection(purpose: string): Redis {
    const existing = this.connections.get(purpose);
    if (existing) {
      return existing;
    }

    const client = new Redis(this.buildOptions());
    this.wireEventLogging(client, purpose);
    this.connections.set(purpose, client);
    return client;
  }

  /**
   * Pings the connection for `purpose` with a bounded timeout. Never
   * throws — connection failures are Redis being unavailable, which is
   * exactly what this method exists to report, not to propagate as an
   * exception to whatever's calling a health endpoint.
   */
  public async healthCheck(purpose: string): Promise<RedisHealthStatus> {
    const client = this.connections.get(purpose);
    if (!client) {
      return { status: 'down', latencyMs: null, connectedClients: this.connections.size };
    }

    if (client.status === 'connecting' || client.status === 'reconnecting') {
      return { status: 'degraded', latencyMs: null, connectedClients: this.connections.size };
    }

    const startedAt = performance.now();
    try {
      await this.withTimeout(client.ping(), HEALTH_CHECK_TIMEOUT_MS, 'health check');
      return { status: 'ok', latencyMs: performance.now() - startedAt, connectedClients: this.connections.size };
    } catch (error) {
      this.logger.error({ purpose, err: error }, 'Redis health check failed');
      return { status: 'down', latencyMs: null, connectedClients: this.connections.size };
    }
  }

  /** Closes every managed connection within a 5-second guard, using `Promise.allSettled` so one slow/failed close never blocks the others. Safe to call with zero connections. */
  public async closeAll(): Promise<void> {
    const closures = [...this.connections.values()].map((client) =>
      this.withTimeout(client.quit(), CLOSE_ALL_TIMEOUT_MS, 'closeAll').catch((error: unknown) => {
        this.logger.warn({ err: error }, 'Redis connection did not close cleanly within the shutdown guard — forcing disconnect');
        client.disconnect();
      }),
    );
    await Promise.allSettled(closures);
    this.connections.clear();
  }

  private buildOptions(): RedisOptions {
    const config = getConfig();

    // Defense-in-depth, not the primary check: envSchema's own
    // `.max(65_535)` already rejects an out-of-range REDIS_PORT at
    // config-load time (before this method ever runs) with a descriptive
    // "Configuration validation failed" error naming the field. This
    // re-validates in case a caller ever constructs `AppConfig` outside
    // the normal `getConfig()` path — e.g. a future test harness or
    // script that bypasses zod entirely.
    if (!Number.isInteger(config.REDIS_PORT) || config.REDIS_PORT < 1 || config.REDIS_PORT > 65_535) {
      throw new RedisConfigurationError(
        `Invalid REDIS_PORT: ${config.REDIS_PORT} — must be an integer between 1 and 65535.`,
      );
    }

    return {
      host: config.REDIS_HOST,
      port: config.REDIS_PORT,
      // '' and undefined both mean "no auth" — ioredis itself only skips
      // AUTH when the option is undefined, not for an empty string.
      password: config.REDIS_PASSWORD === '' ? undefined : config.REDIS_PASSWORD,
      db: config.REDIS_DB,
      // Required by BullMQ — without this, ioredis gives up retrying a
      // request after its own internal limit, which BullMQ's blocking
      // commands can't tolerate.
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
      retryStrategy: (attempt: number): number | null => {
        if (attempt > config.REDIS_MAX_RETRIES) {
          return null;
        }
        return Math.min(attempt * config.REDIS_RETRY_DELAY_MS, 30_000);
      },
    };
  }

  private wireEventLogging(client: Redis, purpose: string): void {
    client.on('connect', () => this.logger.info({ purpose }, 'Redis connecting'));
    client.on('ready', () => this.logger.info({ purpose }, 'Redis ready'));
    client.on('error', (error: Error) => this.logger.error({ purpose, err: error }, 'Redis connection error'));
    client.on('reconnecting', (delayMs: number) => this.logger.warn({ purpose, delayMs }, 'Redis reconnecting'));
    client.on('close', () => this.logger.warn({ purpose }, 'Redis connection closed'));
    client.on('end', () => this.logger.warn({ purpose }, 'Redis connection ended — no further reconnection attempts'));
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Redis ${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }
}
