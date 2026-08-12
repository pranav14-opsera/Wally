import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { customRedisEnv, defaultRedisEnv, redisWithAuthEnv } from '../../fixtures/queue/redis-env-configs.fixture.js';
import type { RedisConnectionFactory as RedisConnectionFactoryType } from '../../../src/queue/redis-connection.js';

// vi.hoisted() callbacks run before any top-level import is evaluated
// (that's what lets vi.mock() factories below safely reference their
// return value) — so this can't extend node:events' EventEmitter, which
// would still be an unresolved import binding at that point. A minimal
// hand-rolled on/emit pair covers everything the tests below need.
const { FakeRedisClient, createdClients } = vi.hoisted(() => {
  class FakeRedisClientImpl {
    public status: 'connecting' | 'connect' | 'ready' | 'reconnecting' | 'close' | 'end' = 'connecting';
    public readonly pingMock = vi.fn(async () => 'PONG');
    public readonly quitMock = vi.fn(async () => 'OK');
    public readonly disconnectMock = vi.fn();
    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    public constructor(public readonly options: Record<string, unknown>) {}

    public on(event: string, handler: (...args: unknown[]) => void): this {
      const existing = this.listeners.get(event) ?? [];
      existing.push(handler);
      this.listeners.set(event, existing);
      return this;
    }

    public emit(event: string, ...args: unknown[]): void {
      for (const handler of this.listeners.get(event) ?? []) {
        handler(...args);
      }
    }

    public ping(): Promise<string> {
      return this.pingMock();
    }

    public quit(): Promise<string> {
      return this.quitMock();
    }

    public disconnect(): void {
      this.disconnectMock();
    }
  }
  return { FakeRedisClient: FakeRedisClientImpl, createdClients: [] as FakeRedisClientImpl[] };
});

vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation((options: Record<string, unknown>) => {
    const client = new FakeRedisClient(options);
    createdClients.push(client);
    return client;
  }),
}));

const silentLogger = pino({ level: 'silent' });
const ORIGINAL_ENV = process.env;

let RedisConnectionFactory: typeof RedisConnectionFactoryType;
let RedisConfigurationError: new (message: string) => Error;

beforeEach(async () => {
  vi.resetModules();
  createdClients.length = 0;
  process.env = defaultRedisEnv;
  ({ RedisConnectionFactory } = await import('../../../src/queue/redis-connection.js'));
  ({ RedisConfigurationError } = await import('../../../src/queue/errors.js'));
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('RedisConnectionFactory', () => {
  describe('createConnection', () => {
    it('creates a connection using REDIS_HOST/PORT/PASSWORD/DB from config, with maxRetriesPerRequest:null for BullMQ', () => {
      process.env = customRedisEnv;
      const factory = new RedisConnectionFactory(silentLogger);

      factory.createConnection('queue:integration');

      expect(createdClients).toHaveLength(1);
      expect(createdClients[0]?.options).toMatchObject({
        host: 'redis.internal',
        port: 6380,
        db: 2,
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        lazyConnect: false,
      });
    });

    it('falls back to sensible defaults (localhost:6379, db 0) when REDIS_HOST/PORT/DB are unset', () => {
      const factory = new RedisConnectionFactory(silentLogger);
      factory.createConnection('default');

      expect(createdClients[0]?.options).toMatchObject({ host: 'localhost', port: 6379, db: 0 });
    });

    it('treats an empty-string REDIS_PASSWORD the same as an unset one — passes undefined to ioredis', () => {
      process.env = { ...process.env, REDIS_PASSWORD: '' };
      const factory = new RedisConnectionFactory(silentLogger);
      factory.createConnection('default');

      expect(createdClients[0]?.options.password).toBeUndefined();
    });

    it('passes a non-empty REDIS_PASSWORD through as-is', () => {
      process.env = redisWithAuthEnv;
      const factory = new RedisConnectionFactory(silentLogger);
      factory.createConnection('default');

      expect(createdClients[0]?.options.password).toBe('super-secret');
    });

    it('returns the existing connection for a purpose that was already created, rather than a new one', () => {
      const factory = new RedisConnectionFactory(silentLogger);
      const first = factory.createConnection('queue:integration');
      const second = factory.createConnection('queue:integration');

      expect(second).toBe(first);
      expect(createdClients).toHaveLength(1);
    });

    it('creates independent connections for different purposes (e.g. Queue vs a future Worker)', () => {
      const factory = new RedisConnectionFactory(silentLogger);
      const queueConn = factory.createConnection('queue:integration');
      const workerConn = factory.createConnection('worker:integration');

      expect(queueConn).not.toBe(workerConn);
      expect(createdClients).toHaveLength(2);
    });

    it('retryStrategy backs off linearly by REDIS_RETRY_DELAY_MS, capped at 30s, and gives up after REDIS_MAX_RETRIES', () => {
      process.env = { ...process.env, REDIS_RETRY_DELAY_MS: '500', REDIS_MAX_RETRIES: '3' };
      const factory = new RedisConnectionFactory(silentLogger);
      factory.createConnection('default');

      const retryStrategy = createdClients[0]?.options.retryStrategy as (attempt: number) => number | null;
      expect(retryStrategy(1)).toBe(500);
      expect(retryStrategy(3)).toBe(1500);
      expect(retryStrategy(4)).toBeNull();
      expect(retryStrategy(100)).toBeNull();
    });

    it('retryStrategy caps the delay at 30 seconds even with a large REDIS_RETRY_DELAY_MS', () => {
      process.env = { ...process.env, REDIS_RETRY_DELAY_MS: '20000', REDIS_MAX_RETRIES: '10' };
      const factory = new RedisConnectionFactory(silentLogger);
      factory.createConnection('default');

      const retryStrategy = createdClients[0]?.options.retryStrategy as (attempt: number) => number | null;
      expect(retryStrategy(3)).toBe(30_000);
    });

    it('logs connect/ready/error/reconnecting/close/end events with the purpose as context', () => {
      const infoSpy = vi.spyOn(silentLogger, 'info');
      const warnSpy = vi.spyOn(silentLogger, 'warn');
      const errorSpy = vi.spyOn(silentLogger, 'error');
      const factory = new RedisConnectionFactory(silentLogger);
      const client = factory.createConnection('queue:integration') as unknown as InstanceType<typeof FakeRedisClient>;

      client.emit('connect');
      client.emit('ready');
      client.emit('reconnecting', 500);
      client.emit('close');
      client.emit('end');
      client.emit('error', new Error('boom'));

      expect(infoSpy).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'queue:integration' }), 'Redis connecting');
      expect(infoSpy).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'queue:integration' }), 'Redis ready');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'queue:integration', delayMs: 500 }),
        'Redis reconnecting',
      );
      expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'queue:integration' }), 'Redis connection error');
    });

    it('throws RedisConfigurationError for a REDIS_PORT outside 1-65535 even if it somehow bypassed schema validation', async () => {
      const { loadConfig } = await import('../../../src/config/loader.js');
      const badConfigModule = await import('../../../src/config/index.js');
      vi.spyOn(badConfigModule, 'getConfig').mockReturnValue({
        ...loadConfig(process.env),
        REDIS_PORT: 70_000,
      });

      const factory = new RedisConnectionFactory(silentLogger);
      expect(() => factory.createConnection('default')).toThrow(RedisConfigurationError);
    });
  });

  describe('healthCheck', () => {
    it('returns status "down" for a purpose with no connection yet', async () => {
      const factory = new RedisConnectionFactory(silentLogger);
      await expect(factory.healthCheck('never-created')).resolves.toEqual({
        status: 'down',
        latencyMs: null,
        connectedClients: 0,
      });
    });

    it('returns status "degraded" while the connection is still connecting', async () => {
      const factory = new RedisConnectionFactory(silentLogger);
      const client = factory.createConnection('default');
      (client as unknown as { status: string }).status = 'connecting';

      const result = await factory.healthCheck('default');
      expect(result.status).toBe('degraded');
      expect(result.latencyMs).toBeNull();
    });

    it('returns status "ok" with a measured latency when ping succeeds on a ready connection', async () => {
      const factory = new RedisConnectionFactory(silentLogger);
      const client = factory.createConnection('default');
      (client as unknown as { status: string }).status = 'ready';

      const result = await factory.healthCheck('default');
      expect(result.status).toBe('ok');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.connectedClients).toBe(1);
    });

    it('returns status "down" when ping rejects on a ready connection', async () => {
      const factory = new RedisConnectionFactory(silentLogger);
      const client = factory.createConnection('default') as unknown as InstanceType<typeof FakeRedisClient>;
      client.status = 'ready';
      client.pingMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await factory.healthCheck('default');
      expect(result.status).toBe('down');
    });
  });

  describe('closeAll', () => {
    it('completes without error when no connections exist', async () => {
      const factory = new RedisConnectionFactory(silentLogger);
      await expect(factory.closeAll()).resolves.toBeUndefined();
    });

    it('calls quit() on every managed connection and clears them', async () => {
      const factory = new RedisConnectionFactory(silentLogger);
      factory.createConnection('a');
      factory.createConnection('b');

      await factory.closeAll();

      expect(createdClients[0]?.quitMock).toHaveBeenCalledTimes(1);
      expect(createdClients[1]?.quitMock).toHaveBeenCalledTimes(1);

      const status = await factory.healthCheck('a');
      expect(status.status).toBe('down');
    });

    it('force-disconnects a connection whose quit() never resolves, instead of hanging past the 5s shutdown guard', async () => {
      vi.useFakeTimers();
      try {
        const factory = new RedisConnectionFactory(silentLogger);
        const client = factory.createConnection('slow') as unknown as InstanceType<typeof FakeRedisClient>;
        client.quitMock.mockImplementation(() => new Promise(() => {}));

        const closeAllPromise = factory.closeAll();
        await vi.advanceTimersByTimeAsync(5_000);
        await closeAllPromise;

        expect(client.disconnectMock).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
