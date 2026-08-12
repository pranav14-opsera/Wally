import { Queue } from 'bullmq';
import type { Logger } from 'pino';

import { QueueInitializationError } from './errors.js';
import type { QueueConfig } from './queue-config.js';
import type { RedisConnectionFactory } from './redis-connection.js';

/**
 * Creates one BullMQ `Queue` per agent type on demand — never a
 * hardcoded list of queue names, per this WO's constraint. Each queue's
 * connection is requested from `RedisConnectionFactory` under its own
 * `queue:<agentType>` purpose key, so multiple agent-type queues don't
 * share a connection with each other or with a future Worker.
 */
export class QueueManager {
  private readonly queues = new Map<string, Queue>();

  public constructor(
    private readonly redisFactory: RedisConnectionFactory,
    private readonly config: QueueConfig,
    private readonly logger: Logger,
  ) {}

  /** Returns the existing queue for `agentType` if one was already created, otherwise builds and caches a new one. */
  public createQueue(agentType: string): Queue {
    const existing = this.queues.get(agentType);
    if (existing) {
      return existing;
    }

    try {
      const connection = this.redisFactory.createConnection(`queue:${agentType}`);
      const queue = new Queue(agentType, {
        connection,
        defaultJobOptions: {
          attempts: this.config.jobAttempts,
          backoff: { type: 'exponential', delay: this.config.backoffDelayMs },
        },
      });
      this.queues.set(agentType, queue);
      this.logger.info({ agentType }, 'Queue created');
      return queue;
    } catch (error) {
      throw new QueueInitializationError(agentType, error);
    }
  }

  public getQueue(agentType: string): Queue | undefined {
    return this.queues.get(agentType);
  }

  public listQueues(): string[] {
    return [...this.queues.keys()];
  }

  /** Closes every managed queue. Safe to call with zero queues. */
  public async closeAll(): Promise<void> {
    const closures = [...this.queues.values()].map((queue) => queue.close());
    await Promise.allSettled(closures);
    this.queues.clear();
  }
}
