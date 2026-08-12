import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';

import { getConfig } from '../config/index.js';
import { createLogger } from '../logging/index.js';
import { QueueManager } from '../queue/queue-manager.js';
import { loadQueueConfig } from '../queue/queue-config.js';
import { RedisConnectionFactory } from '../queue/redis-connection.js';
import type { AgentDispatcher } from './agent-dispatcher.js';
import { GracefulShutdownHandler } from './shutdown-handler.js';
import { HealthServer } from './health-server.js';
import type { AgentJobData, DeadLetterEntry } from './types.js';

export interface WorkerProcessContainer {
  workers: Worker[];
  redisFactory: RedisConnectionFactory;
  queueManager: QueueManager;
  healthServer: HealthServer;
  shutdownHandler: GracefulShutdownHandler;
  logger: Logger;
}

function dlqQueueName(agentType: string): string {
  return `${agentType}-dlq`;
}

function wireWorkerEvents(worker: Worker<AgentJobData>, agentType: string, queueManager: QueueManager, maxAttempts: number, logger: Logger): void {
  worker.on('completed', (job) => {
    logger.info({ agentType, jobId: job.id, dataJobId: job.data.jobId }, 'Job completed');
  });

  worker.on('failed', (job, error) => {
    if (!job) {
      logger.error({ agentType, err: error }, 'Job failed (job data unavailable — likely a stalled job removed by removeOnFail)');
      return;
    }

    logger.error(
      { agentType, jobId: job.id, dataJobId: job.data.jobId, attemptsMade: job.attemptsMade, maxAttempts, err: error },
      'Job failed',
    );

    if (job.attemptsMade < maxAttempts) {
      logger.info({ agentType, jobId: job.id, attemptsMade: job.attemptsMade, maxAttempts }, 'Retry scheduled');
      return;
    }

    const dlqEntry: DeadLetterEntry = {
      originalJobId: job.id ?? 'unknown',
      agentType,
      jobData: job.data,
      failureReason: error.message,
      failedAt: new Date().toISOString(),
      attemptsMade: job.attemptsMade,
    };

    queueManager
      .createQueue(dlqQueueName(agentType))
      .add('dead-letter', dlqEntry)
      .then(() => logger.warn({ agentType, jobId: job.id, dlqQueue: dlqQueueName(agentType) }, 'Job routed to dead letter queue'))
      .catch((dlqError: unknown) => {
        logger.error(
          { agentType, jobId: job.id, err: dlqError, originalPayload: dlqEntry },
          'Failed to route exhausted job to dead letter queue — see originalPayload for manual recovery',
        );
      });
  });

  worker.on('error', (error) => {
    logger.error({ agentType, err: error }, 'Worker connection error');
  });

  worker.on('stalled', (jobId) => {
    logger.warn({ agentType, jobId }, 'Job stalled — moved back to the wait list');
  });
}

/**
 * The worker process's composition root (WO-032) — separate from
 * `src/bootstrap.ts` (the gateway's), per this WO's constraint that the
 * worker never imports gateway-specific code. Creates one BullMQ
 * `Worker` per `dispatcher.registeredTypes()` — not a hardcoded agent
 * type list. No concrete `BaseAgent` subclass exists in the codebase
 * yet (Integration/Validation/Load Testing/API Lifecycle all land in
 * later WOs), so `dispatcher` starts empty and this legitimately
 * creates zero `Worker` instances until a caller registers at least one
 * agent type — that's correct, not a bug, matching the "queue names
 * derived from a registered agent types list" constraint literally.
 */
export function workerBootstrap(dispatcher: AgentDispatcher): WorkerProcessContainer {
  const config = getConfig();
  const logger = createLogger('worker');
  const redisFactory = new RedisConnectionFactory(logger);
  const queueManager = new QueueManager(redisFactory, loadQueueConfig(), logger);

  const workers = dispatcher.registeredTypes().map((agentType) => {
    const connection = redisFactory.createConnection(`worker:${agentType}`);
    const worker = new Worker<AgentJobData>(
      agentType,
      async (job: Job<AgentJobData>) => dispatcher.dispatch(agentType, job.data.jobId, job.data.input),
      {
        connection,
        concurrency: config.QUEUE_CONCURRENCY,
        lockDuration: config.WORKER_LOCK_DURATION_MS,
        stalledInterval: config.WORKER_STALLED_INTERVAL_MS,
        limiter: { max: config.QUEUE_RATE_LIMIT_MAX, duration: config.QUEUE_RATE_LIMIT_DURATION_MS },
      },
    );
    wireWorkerEvents(worker, agentType, queueManager, config.QUEUE_JOB_ATTEMPTS, logger);
    logger.info({ agentType, concurrency: config.QUEUE_CONCURRENCY }, 'Worker started');
    return worker;
  });

  let shutdownHandler: GracefulShutdownHandler;
  const healthServer = new HealthServer(config.WORKER_HEALTH_PORT, () => !shutdownHandler.shuttingDown, logger);

  shutdownHandler = new GracefulShutdownHandler(
    workers,
    async () => {
      await healthServer.stop();
      await queueManager.closeAll();
      await redisFactory.closeAll();
    },
    config.WORKER_DRAIN_TIMEOUT_MS,
    logger,
  );

  return { workers, redisFactory, queueManager, healthServer, shutdownHandler, logger };
}
