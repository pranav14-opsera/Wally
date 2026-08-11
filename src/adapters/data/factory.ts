import type { Model } from 'mongoose';
import type { Logger } from 'pino';

import { createLogger } from '../../logging/index.js';
import { ConnectionError } from './errors.js';
import type { PrismaModelDelegate } from './prisma/PrismaRepository.js';
import type { DataAdapterConfig } from './types/DataAdapterConfig.js';
import type { DataAdapterContext, DataAdapterRepositories } from './types/DataAdapterContext.js';
import type {
  AuditLog,
  ConfigRegistryEntry,
  DriftEvent,
  JobStep,
  LoadTestResult,
  MetricRegistryEntry,
  SpecRegistryEntry,
  ToolRegistryEntry,
  User,
} from './entities/index.js';

/**
 * Races `promise` against a timeout, rejecting with a message naming
 * which operation timed out rather than either hanging forever (no
 * timeout at all) or surfacing a bare generic timer-rejection with no
 * context about what it was waiting on.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Builds every entity's repository against the Postgres/Prisma adapter
 * (WO-008/WO-009). Every Prisma-specific module is loaded via dynamic
 * `import()` — never at this file's top level — so selecting
 * `DATA_ENGINE=mongo` never pulls `@prisma/client`'s generated client (or
 * triggers its own module-level side effects) into the process at all,
 * per this WO's constraint against unconditionally importing both engines.
 */
async function buildPostgresContext(logger: Logger): Promise<DataAdapterContext> {
  const [{ getPrismaClient, healthCheck, disconnectPrismaClient }, { PrismaRepository }, { PrismaAgentJobRepository }] =
    await Promise.all([
      import('./prisma/prisma-client.js'),
      import('./prisma/PrismaRepository.js'),
      import('./prisma/PrismaAgentJobRepository.js'),
    ]);

  const prisma = getPrismaClient();

  const repositories: DataAdapterRepositories = {
    users: new PrismaRepository<User>(prisma, (c) => c.user as unknown as PrismaModelDelegate<User>, 'User', logger),
    agentJobs: new PrismaAgentJobRepository(prisma, logger),
    jobSteps: new PrismaRepository<JobStep>(
      prisma,
      (c) => c.jobStep as unknown as PrismaModelDelegate<JobStep>,
      'JobStep',
      logger,
    ),
    toolRegistry: new PrismaRepository<ToolRegistryEntry>(
      prisma,
      (c) => c.toolRegistry as unknown as PrismaModelDelegate<ToolRegistryEntry>,
      'ToolRegistryEntry',
      logger,
    ),
    metricRegistry: new PrismaRepository<MetricRegistryEntry>(
      prisma,
      (c) => c.metricRegistry as unknown as PrismaModelDelegate<MetricRegistryEntry>,
      'MetricRegistryEntry',
      logger,
    ),
    configRegistry: new PrismaRepository<ConfigRegistryEntry>(
      prisma,
      (c) => c.configRegistry as unknown as PrismaModelDelegate<ConfigRegistryEntry>,
      'ConfigRegistryEntry',
      logger,
    ),
    specRegistry: new PrismaRepository<SpecRegistryEntry>(
      prisma,
      (c) => c.specRegistry as unknown as PrismaModelDelegate<SpecRegistryEntry>,
      'SpecRegistryEntry',
      logger,
    ),
    auditLogs: new PrismaRepository<AuditLog>(
      prisma,
      (c) => c.auditLog as unknown as PrismaModelDelegate<AuditLog>,
      'AuditLog',
      logger,
    ),
    driftEvents: new PrismaRepository<DriftEvent>(
      prisma,
      (c) => c.driftEvent as unknown as PrismaModelDelegate<DriftEvent>,
      'DriftEvent',
      logger,
    ),
    loadTestResults: new PrismaRepository<LoadTestResult>(
      prisma,
      (c) => c.loadTestResult as unknown as PrismaModelDelegate<LoadTestResult>,
      'LoadTestResult',
      logger,
    ),
  };

  return {
    engine: 'postgres',
    repositories,
    healthCheck,
    disconnect: disconnectPrismaClient,
  };
}

/**
 * Builds every entity's repository against the Mongo/Mongoose adapter
 * (WO-010/WO-011), symmetrically to `buildPostgresContext` — dynamic
 * `import()` only, so `DATA_ENGINE=postgres` never loads `mongoose` (or
 * registers its models/connection) at all.
 */
async function buildMongoContext(logger: Logger): Promise<DataAdapterContext> {
  const [
    { getMongooseModels, healthCheck, disconnectMongoose },
    { MongooseRepository },
    { MongooseAgentJobRepository },
    { MongooseJobStepRepository },
    { MongooseDriftEventRepository },
  ] = await Promise.all([
    import('./mongoose/mongoose-client.js'),
    import('./mongoose/MongooseRepository.js'),
    import('./mongoose/MongooseAgentJobRepository.js'),
    import('./mongoose/MongooseJobStepRepository.js'),
    import('./mongoose/MongooseDriftEventRepository.js'),
  ]);

  const models = await getMongooseModels();
  const asModel = (model: unknown): Model<Record<string, unknown>> => model as Model<Record<string, unknown>>;

  const repositories: DataAdapterRepositories = {
    users: new MongooseRepository<User>(asModel(models.User), 'User', logger),
    agentJobs: new MongooseAgentJobRepository(asModel(models.AgentJob), logger),
    jobSteps: new MongooseJobStepRepository(asModel(models.AgentJob), logger),
    toolRegistry: new MongooseRepository<ToolRegistryEntry>(asModel(models.ToolRegistry), 'ToolRegistryEntry', logger),
    metricRegistry: new MongooseRepository<MetricRegistryEntry>(asModel(models.MetricRegistry), 'MetricRegistryEntry', logger),
    configRegistry: new MongooseRepository<ConfigRegistryEntry>(asModel(models.ConfigRegistry), 'ConfigRegistryEntry', logger),
    specRegistry: new MongooseRepository<SpecRegistryEntry>(asModel(models.SpecRegistry), 'SpecRegistryEntry', logger),
    auditLogs: new MongooseRepository<AuditLog>(asModel(models.AuditLog), 'AuditLog', logger),
    driftEvents: new MongooseDriftEventRepository(asModel(models.AgentJob), logger),
    loadTestResults: new MongooseRepository<LoadTestResult>(asModel(models.LoadTestResult), 'LoadTestResult', logger),
  };

  return {
    engine: 'mongo',
    repositories,
    healthCheck,
    disconnect: disconnectMongoose,
  };
}

/**
 * Builds the fully-wired `DataAdapterContext` for `config.engine` and
 * verifies the database is actually reachable before returning — the
 * composition root (bootstrap.ts) is expected to let a rejection here
 * propagate and terminate startup (AC5: "logs a structured error and
 * exits with a non-zero code"), rather than silently returning an
 * adapter nothing can actually use.
 *
 * `DATA_ENGINE` itself being an invalid enum value or genuinely absent
 * is already caught earlier, at `getConfig()`/`envSchema` (src/config/
 * schema.ts's `z.enum(['postgres','mongo'])`, already covered by
 * tests/unit/config/loader.test.ts). The explicit check below is
 * defense-in-depth for this function's own direct callers (unit tests,
 * or any future caller that builds a `DataAdapterConfig` by hand rather
 * than via `buildDataAdapterConfig(getConfig().DATA_ENGINE)`) — without
 * it, an invalid `config.engine` would silently fall through to the
 * Mongo branch (the ternary below has only two arms), which is exactly
 * the "cryptic" failure mode AC3/AC4 exist to prevent.
 */
const VALID_ENGINES = ['postgres', 'mongo'] as const;

export async function createDataAdapter(config: DataAdapterConfig): Promise<DataAdapterContext> {
  if (!VALID_ENGINES.includes(config.engine)) {
    throw new Error(
      `Invalid DATA_ENGINE "${String(config.engine)}" — valid options are: ${VALID_ENGINES.join(', ')}.`,
    );
  }

  const logger = createLogger(`DataAdapter:${config.engine}`);
  const context = config.engine === 'postgres' ? await buildPostgresContext(logger) : await buildMongoContext(logger);

  let healthy: boolean;
  try {
    healthy = await withTimeout(
      context.healthCheck(),
      config.healthCheckTimeoutMs,
      `Health check for DATA_ENGINE=${config.engine} timed out after ${config.healthCheckTimeoutMs}ms`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConnectionError(
      `Database connection health check failed for DATA_ENGINE=${config.engine}: ${message}`,
    );
  }

  if (!healthy) {
    throw new ConnectionError(
      `Database connection health check reported unhealthy for DATA_ENGINE=${config.engine} — ` +
        'the database is unreachable, unauthenticated, or misconfigured.',
    );
  }

  logger.info({ engine: config.engine }, 'Data adapter connected and healthy');
  return context;
}
