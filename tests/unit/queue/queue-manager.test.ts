import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QueueInitializationError } from '../../../src/queue/errors.js';
import type { QueueConfig } from '../../../src/queue/queue-config.js';
import { QueueManager } from '../../../src/queue/queue-manager.js';
import type { RedisConnectionFactory } from '../../../src/queue/redis-connection.js';

const { FakeQueue, createdQueues } = vi.hoisted(() => {
  class FakeQueueImpl {
    public readonly closeMock = vi.fn(async () => undefined);

    public constructor(
      public readonly name: string,
      public readonly opts: Record<string, unknown>,
    ) {}

    public close(): Promise<void> {
      return this.closeMock();
    }
  }
  return { FakeQueue: FakeQueueImpl, createdQueues: [] as FakeQueueImpl[] };
});

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation((name: string, opts: Record<string, unknown>) => {
    const queue = new FakeQueue(name, opts);
    createdQueues.push(queue);
    return queue;
  }),
}));

const silentLogger = pino({ level: 'silent' });
const CONFIG: QueueConfig = {
  concurrency: 5,
  jobAttempts: 3,
  backoffDelayMs: 2_000,
  rateLimitMax: 10,
  rateLimitDurationMs: 1_000,
};

function createFakeRedisFactory(): RedisConnectionFactory {
  return {
    createConnection: vi.fn((purpose: string) => ({ purpose })),
    healthCheck: vi.fn(),
    closeAll: vi.fn(async () => undefined),
  } as unknown as RedisConnectionFactory;
}

let redisFactory: RedisConnectionFactory;

beforeEach(() => {
  createdQueues.length = 0;
  redisFactory = createFakeRedisFactory();
});

describe('QueueManager', () => {
  describe('createQueue', () => {
    it('creates a BullMQ Queue named after the agent type, with defaultJobOptions from QueueConfig', () => {
      const manager = new QueueManager(redisFactory, CONFIG, silentLogger);
      const queue = manager.createQueue('integration') as unknown as InstanceType<typeof FakeQueue>;

      expect(queue.name).toBe('integration');
      expect(queue.opts).toMatchObject({
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2_000 },
        },
      });
    });

    it('requests a connection from the Redis factory under a queue:<agentType> purpose key', () => {
      const manager = new QueueManager(redisFactory, CONFIG, silentLogger);
      manager.createQueue('validation');

      expect(redisFactory.createConnection).toHaveBeenCalledWith('queue:validation');
    });

    it('creates queues dynamically for any agent type string — not a hardcoded list', () => {
      const manager = new QueueManager(redisFactory, CONFIG, silentLogger);
      for (const agentType of ['integration', 'validation', 'load-testing', 'api-lifecycle', 'some-future-agent']) {
        manager.createQueue(agentType);
      }

      expect(createdQueues.map((q) => q.name)).toEqual([
        'integration',
        'validation',
        'load-testing',
        'api-lifecycle',
        'some-future-agent',
      ]);
    });

    it('returns the existing queue for an agent type that was already created, rather than a new one', () => {
      const manager = new QueueManager(redisFactory, CONFIG, silentLogger);
      const first = manager.createQueue('integration');
      const second = manager.createQueue('integration');

      expect(second).toBe(first);
      expect(createdQueues).toHaveLength(1);
    });

    it('wraps a construction failure in QueueInitializationError, naming the agent type', () => {
      vi.mocked(redisFactory.createConnection).mockImplementationOnce(() => {
        throw new Error('redis unavailable');
      });

      const manager = new QueueManager(redisFactory, CONFIG, silentLogger);
      let thrown: QueueInitializationError | undefined;
      try {
        manager.createQueue('integration');
        expect.unreachable();
      } catch (error) {
        thrown = error as QueueInitializationError;
      }

      expect(thrown).toBeInstanceOf(QueueInitializationError);
      expect(thrown?.agentType).toBe('integration');
      expect(thrown?.message).toContain('integration');
      expect(thrown?.message).toContain('redis unavailable');
    });
  });

  describe('getQueue / listQueues', () => {
    it('getQueue returns undefined for an agent type that has no queue yet', () => {
      const manager = new QueueManager(redisFactory, CONFIG, silentLogger);
      expect(manager.getQueue('never-created')).toBeUndefined();
    });

    it('getQueue returns the same instance createQueue returned', () => {
      const manager = new QueueManager(redisFactory, CONFIG, silentLogger);
      const created = manager.createQueue('integration');
      expect(manager.getQueue('integration')).toBe(created);
    });

    it('listQueues returns every created agent type name', () => {
      const manager = new QueueManager(redisFactory, CONFIG, silentLogger);
      manager.createQueue('integration');
      manager.createQueue('validation');

      expect(manager.listQueues().sort()).toEqual(['integration', 'validation']);
    });

    it('listQueues returns an empty array when nothing has been created', () => {
      const manager = new QueueManager(redisFactory, CONFIG, silentLogger);
      expect(manager.listQueues()).toEqual([]);
    });
  });

  describe('closeAll', () => {
    it('completes without error when no queues exist', async () => {
      const manager = new QueueManager(redisFactory, CONFIG, silentLogger);
      await expect(manager.closeAll()).resolves.toBeUndefined();
    });

    it('calls close() on every managed queue and clears them', async () => {
      const manager = new QueueManager(redisFactory, CONFIG, silentLogger);
      manager.createQueue('integration');
      manager.createQueue('validation');

      await manager.closeAll();

      expect(createdQueues[0]?.closeMock).toHaveBeenCalledTimes(1);
      expect(createdQueues[1]?.closeMock).toHaveBeenCalledTimes(1);
      expect(manager.listQueues()).toEqual([]);
    });

    it('one queue failing to close does not prevent the others from closing (Promise.allSettled semantics)', async () => {
      const manager = new QueueManager(redisFactory, CONFIG, silentLogger);
      manager.createQueue('integration');
      manager.createQueue('validation');
      createdQueues[0]!.closeMock.mockRejectedValueOnce(new Error('close failed'));

      await expect(manager.closeAll()).resolves.toBeUndefined();
      expect(createdQueues[1]?.closeMock).toHaveBeenCalledTimes(1);
    });
  });
});
