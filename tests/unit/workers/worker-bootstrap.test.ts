import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createValidPostgresEnv } from '../../fixtures/env.fixture.js';
import type { AgentDispatcher as AgentDispatcherType } from '../../../src/workers/agent-dispatcher.js';
import type { workerBootstrap as workerBootstrapType } from '../../../src/workers/worker-bootstrap.js';

const { FakeRedis, FakeWorker, FakeQueue, createdWorkers, createdQueues } = vi.hoisted(() => {
  class FakeRedisImpl {
    public status: 'connecting' | 'ready' = 'ready';
    public constructor(public readonly options: Record<string, unknown>) {}
    public on(): this {
      return this;
    }
    public async ping(): Promise<string> {
      return 'PONG';
    }
    public async quit(): Promise<'OK'> {
      return 'OK';
    }
    public disconnect(): void {
      // no-op — matches ioredis's own fire-and-forget disconnect() signature.
    }
  }

  class FakeWorkerImpl {
    public readonly closeMock = vi.fn(async () => undefined);
    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    public constructor(
      public readonly name: string,
      public readonly processor: (...args: unknown[]) => unknown,
      public readonly opts: Record<string, unknown>,
    ) {}

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

    public close(): Promise<void> {
      return this.closeMock();
    }
  }

  class FakeQueueImpl {
    public readonly addMock = vi.fn(async () => ({ id: 'dlq-job-1' }));
    public readonly closeMock = vi.fn(async () => undefined);

    public constructor(
      public readonly name: string,
      public readonly opts: Record<string, unknown>,
    ) {}

    public add(...args: unknown[]): Promise<{ id: string }> {
      return this.addMock(...args);
    }

    public close(): Promise<void> {
      return this.closeMock();
    }
  }

  return {
    FakeRedis: FakeRedisImpl,
    FakeWorker: FakeWorkerImpl,
    FakeQueue: FakeQueueImpl,
    createdWorkers: [] as FakeWorkerImpl[],
    createdQueues: [] as FakeQueueImpl[],
  };
});

vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation((options: Record<string, unknown>) => new FakeRedis(options)),
}));

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation((name: string, processor: (...args: unknown[]) => unknown, opts: Record<string, unknown>) => {
    const worker = new FakeWorker(name, processor, opts);
    createdWorkers.push(worker);
    return worker;
  }),
  Queue: vi.fn().mockImplementation((name: string, opts: Record<string, unknown>) => {
    const queue = new FakeQueue(name, opts);
    createdQueues.push(queue);
    return queue;
  }),
}));

const ORIGINAL_ENV = process.env;

let AgentDispatcher: typeof AgentDispatcherType;
let workerBootstrap: typeof workerBootstrapType;

beforeEach(async () => {
  vi.resetModules();
  createdWorkers.length = 0;
  createdQueues.length = 0;
  process.env = createValidPostgresEnv() as NodeJS.ProcessEnv;
  ({ AgentDispatcher } = await import('../../../src/workers/agent-dispatcher.js'));
  ({ workerBootstrap } = await import('../../../src/workers/worker-bootstrap.js'));
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('workerBootstrap', () => {
  it('creates zero BullMQ Worker instances for a dispatcher with nothing registered', () => {
    const dispatcher = new AgentDispatcher();
    const container = workerBootstrap(dispatcher);

    expect(container.workers).toHaveLength(0);
    expect(createdWorkers).toHaveLength(0);
  });

  it('creates one BullMQ Worker per registered agent type, named after that type', () => {
    const dispatcher = new AgentDispatcher();
    dispatcher.register('integration', () => ({ execute: vi.fn() }));
    dispatcher.register('validation', () => ({ execute: vi.fn() }));

    workerBootstrap(dispatcher);

    expect(createdWorkers.map((w) => w.name).sort()).toEqual(['integration', 'validation']);
  });

  it('passes concurrency/lockDuration/stalledInterval/limiter options sourced from config, not bare literals', () => {
    process.env = {
      ...process.env,
      QUEUE_CONCURRENCY: '7',
      WORKER_LOCK_DURATION_MS: '45000',
      WORKER_STALLED_INTERVAL_MS: '20000',
      QUEUE_RATE_LIMIT_MAX: '33',
      QUEUE_RATE_LIMIT_DURATION_MS: '500',
    };
    const dispatcher = new AgentDispatcher();
    dispatcher.register('integration', () => ({ execute: vi.fn() }));

    workerBootstrap(dispatcher);

    expect(createdWorkers[0]?.opts).toMatchObject({
      concurrency: 7,
      lockDuration: 45_000,
      stalledInterval: 20_000,
      limiter: { max: 33, duration: 500 },
    });
  });

  it("each worker's processor dispatches to the correct agent type with the job's jobId/input", async () => {
    const dispatcher = new AgentDispatcher();
    const executeMock = vi.fn(async () => ({ status: 'completed' as const, data: null, error: null }));
    dispatcher.register('integration', () => ({ execute: executeMock }));

    workerBootstrap(dispatcher);
    const worker = createdWorkers[0]!;
    await worker.processor({ id: 'bullmq-job-1', data: { jobId: 'job-1', input: { seed: 3 } } });

    expect(executeMock).toHaveBeenCalledWith('job-1', { seed: 3 });
  });

  describe('worker event wiring', () => {
    it('a "failed" event with attemptsMade below the configured max does not route to the DLQ', () => {
      process.env = { ...process.env, QUEUE_JOB_ATTEMPTS: '5' };
      const dispatcher = new AgentDispatcher();
      dispatcher.register('integration', () => ({ execute: vi.fn() }));
      workerBootstrap(dispatcher);

      createdWorkers[0]!.emit('failed', { id: 'job-1', data: { jobId: 'job-1' }, attemptsMade: 2 }, new Error('transient'));

      expect(createdQueues.find((q) => q.name === 'integration-dlq')).toBeUndefined();
    });

    it('a "failed" event with attemptsMade at the configured max routes the job to the {agentType}-dlq queue', async () => {
      process.env = { ...process.env, QUEUE_JOB_ATTEMPTS: '5' };
      const dispatcher = new AgentDispatcher();
      dispatcher.register('integration', () => ({ execute: vi.fn() }));
      workerBootstrap(dispatcher);

      createdWorkers[0]!.emit(
        'failed',
        { id: 'job-1', data: { jobId: 'job-1', input: { seed: 3 } }, attemptsMade: 5 },
        new Error('permanent failure'),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      const dlqQueue = createdQueues.find((q) => q.name === 'integration-dlq');
      expect(dlqQueue).toBeDefined();
      expect(dlqQueue?.addMock).toHaveBeenCalledWith(
        'dead-letter',
        expect.objectContaining({
          originalJobId: 'job-1',
          agentType: 'integration',
          failureReason: 'permanent failure',
          attemptsMade: 5,
        }),
      );
    });

    it('a "failed" event with job undefined (stalled job removed by removeOnFail) is logged, not crashed on', () => {
      const dispatcher = new AgentDispatcher();
      dispatcher.register('integration', () => ({ execute: vi.fn() }));
      workerBootstrap(dispatcher);

      expect(() => createdWorkers[0]!.emit('failed', undefined, new Error('stalled'))).not.toThrow();
    });

    it('does not throw when "completed"/"error"/"stalled" events fire', () => {
      const dispatcher = new AgentDispatcher();
      dispatcher.register('integration', () => ({ execute: vi.fn() }));
      workerBootstrap(dispatcher);
      const worker = createdWorkers[0]!;

      expect(() => worker.emit('completed', { id: 'job-1', data: { jobId: 'job-1' } })).not.toThrow();
      expect(() => worker.emit('error', new Error('connection error'))).not.toThrow();
      expect(() => worker.emit('stalled', 'job-1')).not.toThrow();
    });
  });

  it('the returned shutdownHandler drains every created worker', async () => {
    const dispatcher = new AgentDispatcher();
    dispatcher.register('integration', () => ({ execute: vi.fn() }));
    dispatcher.register('validation', () => ({ execute: vi.fn() }));

    const container = workerBootstrap(dispatcher);
    await container.shutdownHandler.shutdown('SIGTERM');

    expect(createdWorkers[0]?.closeMock).toHaveBeenCalledTimes(1);
    expect(createdWorkers[1]?.closeMock).toHaveBeenCalledTimes(1);
  });

  it('the health server reports healthy before shutdown and unhealthy after', async () => {
    const dispatcher = new AgentDispatcher();
    const container = workerBootstrap(dispatcher);

    expect(container.shutdownHandler.shuttingDown).toBe(false);
    await container.shutdownHandler.shutdown('SIGTERM');
    expect(container.shutdownHandler.shuttingDown).toBe(true);
  });
});
