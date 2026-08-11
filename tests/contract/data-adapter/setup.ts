import { PrismaPg } from '@prisma/adapter-pg';
import mongoose from 'mongoose';
import type { Connection, Model } from 'mongoose';
import { Client } from 'pg';
import pino from 'pino';
import type { Logger } from 'pino';

import type {
  AgentJob,
  AuditLog,
  ConfigRegistryEntry,
  DriftEvent,
  IAgentJobRepository,
  IRepository,
  JobStep,
  LoadTestResult,
  MetricRegistryEntry,
  SpecRegistryEntry,
  ToolRegistryEntry,
  User,
} from '../../../src/adapters/data/index.js';
import {
  MongooseAgentJobRepository,
  MongooseDriftEventRepository,
  MongooseJobStepRepository,
  MongooseRepository,
  PrismaAgentJobRepository,
  PrismaRepository,
} from '../../../src/adapters/data/index.js';
import type { DelegateResolver, PrismaModelDelegate } from '../../../src/adapters/data/prisma/PrismaRepository.js';
import { buildPgPoolConfig } from '../../../src/adapters/data/prisma/connection-string.js';
import { createModels } from '../../../src/adapters/data/mongoose/models.js';
import type { MongooseModels } from '../../../src/adapters/data/mongoose/models.js';
import { PrismaClient } from '../../../src/generated/prisma/client.js';

/**
 * Shared harness for the contract test suite (WO-012): builds the same
 * `ContractRepositories` shape against whichever engine `DATA_ENGINE`
 * selects, so every `*.contract.test.ts` file's assertions run unchanged
 * against both PrismaRepository (WO-009) and MongooseRepository (WO-011)
 * — REQ-002's cross-engine parity guarantee, proven by literally reusing
 * the same test code rather than two hand-written suites that could drift
 * apart from each other.
 *
 * Each engine's real database is probed once, up front (mirroring
 * tests/integration/{prisma-migration,mongoose-schemas}.test.ts) so an
 * environment with no reachable database (e.g. this sandbox, or a
 * contributor's machine without `docker compose up -d`) skips the whole
 * suite cleanly with one clear message instead of every test failing
 * individually with a connection error.
 */

const CONNECTION_TIMEOUT_MS = 2000;

export type DataEngineUnderTest = 'postgres' | 'mongo';

/** Every entity's `IRepository<T>` (or the richer `IAgentJobRepository` for AgentJob), keyed the same way regardless of engine. */
export interface ContractRepositories {
  user: IRepository<User>;
  agentJob: IAgentJobRepository;
  jobStep: IRepository<JobStep>;
  toolRegistry: IRepository<ToolRegistryEntry>;
  metricRegistry: IRepository<MetricRegistryEntry>;
  configRegistry: IRepository<ConfigRegistryEntry>;
  specRegistry: IRepository<SpecRegistryEntry>;
  auditLog: IRepository<AuditLog>;
  driftEvent: IRepository<DriftEvent>;
  loadTestResult: IRepository<LoadTestResult>;
}

export interface ContractHarness {
  engine: DataEngineUnderTest;
  repositories: ContractRepositories;
  /** Wipes every collection/table's rows — call in `beforeEach` so tests never see another test's leftover data. */
  cleanup(): Promise<void>;
  /** Closes the underlying connection — call once in `afterAll`. */
  teardown(): Promise<void>;
}

/** Reads `DATA_ENGINE` the same way `envSchema` (src/config/schema.ts) does, defaulting to its own default rather than requiring every contract-test invocation to set it explicitly. */
export function resolveEngine(): DataEngineUnderTest {
  const raw = process.env.DATA_ENGINE;
  if (raw === 'mongo') {
    return 'mongo';
  }
  return 'postgres';
}

// ---------------------------------------------------------------------------
// Postgres / Prisma
// ---------------------------------------------------------------------------

const POSTGRES_HOST = process.env.POSTGRES_HOST ?? 'localhost';
const POSTGRES_PORT = Number(process.env.POSTGRES_PORT ?? 5432);
const POSTGRES_USER = process.env.POSTGRES_USER ?? 'wally';
const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD ?? 'change-me';
const POSTGRES_DB = process.env.POSTGRES_DB ?? 'wally';

// Truncated together in one statement (not per-table, in dependency
// order) so FK ordering never matters — CASCADE takes care of it — and
// RESTART IDENTITY isn't actually load-bearing here (ids are UUIDs, not
// serials) but is harmless and future-proofs against a schema change.
const POSTGRES_TABLES = [
  'users',
  'agent_jobs',
  'job_steps',
  'tool_registry',
  'metric_registry',
  'config_registry',
  'spec_registry',
  'audit_logs',
  'drift_events',
  'load_test_results',
];

async function probePostgres(): Promise<boolean> {
  const client = new Client({
    host: POSTGRES_HOST,
    port: POSTGRES_PORT,
    user: POSTGRES_USER,
    password: POSTGRES_PASSWORD,
    database: POSTGRES_DB,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    await client.end().catch(() => undefined);
    return false;
  }
}

function delegateOf<TModel>(resolver: DelegateResolver<TModel>): DelegateResolver<TModel> {
  return resolver;
}

function buildPostgresRepositories(prisma: PrismaClient, logger: Logger): ContractRepositories {
  return {
    user: new PrismaRepository<User>(prisma, delegateOf((c) => c.user as unknown as PrismaModelDelegate<User>), 'User', logger),
    agentJob: new PrismaAgentJobRepository(prisma, logger),
    jobStep: new PrismaRepository<JobStep>(
      prisma,
      delegateOf((c) => c.jobStep as unknown as PrismaModelDelegate<JobStep>),
      'JobStep',
      logger,
    ),
    toolRegistry: new PrismaRepository<ToolRegistryEntry>(
      prisma,
      delegateOf((c) => c.toolRegistry as unknown as PrismaModelDelegate<ToolRegistryEntry>),
      'ToolRegistryEntry',
      logger,
    ),
    metricRegistry: new PrismaRepository<MetricRegistryEntry>(
      prisma,
      delegateOf((c) => c.metricRegistry as unknown as PrismaModelDelegate<MetricRegistryEntry>),
      'MetricRegistryEntry',
      logger,
    ),
    configRegistry: new PrismaRepository<ConfigRegistryEntry>(
      prisma,
      delegateOf((c) => c.configRegistry as unknown as PrismaModelDelegate<ConfigRegistryEntry>),
      'ConfigRegistryEntry',
      logger,
    ),
    specRegistry: new PrismaRepository<SpecRegistryEntry>(
      prisma,
      delegateOf((c) => c.specRegistry as unknown as PrismaModelDelegate<SpecRegistryEntry>),
      'SpecRegistryEntry',
      logger,
    ),
    auditLog: new PrismaRepository<AuditLog>(
      prisma,
      delegateOf((c) => c.auditLog as unknown as PrismaModelDelegate<AuditLog>),
      'AuditLog',
      logger,
    ),
    driftEvent: new PrismaRepository<DriftEvent>(
      prisma,
      delegateOf((c) => c.driftEvent as unknown as PrismaModelDelegate<DriftEvent>),
      'DriftEvent',
      logger,
    ),
    loadTestResult: new PrismaRepository<LoadTestResult>(
      prisma,
      delegateOf((c) => c.loadTestResult as unknown as PrismaModelDelegate<LoadTestResult>),
      'LoadTestResult',
      logger,
    ),
  };
}

async function createPostgresHarness(logger: Logger): Promise<ContractHarness> {
  const adapter = new PrismaPg(
    buildPgPoolConfig({
      host: POSTGRES_HOST,
      port: POSTGRES_PORT,
      user: POSTGRES_USER,
      password: POSTGRES_PASSWORD,
      database: POSTGRES_DB,
    }),
  );
  const prisma = new PrismaClient({ adapter });

  return {
    engine: 'postgres',
    repositories: buildPostgresRepositories(prisma, logger),
    cleanup: async () => {
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE ${POSTGRES_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
      );
    },
    teardown: async () => {
      await prisma.$disconnect();
    },
  };
}

// ---------------------------------------------------------------------------
// Mongo / Mongoose
// ---------------------------------------------------------------------------

const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://localhost:27017';
const MONGO_DB_NAME = `wally_contract_test_${Date.now()}`;

async function probeMongo(): Promise<boolean> {
  const connection = mongoose.createConnection(MONGO_URI, {
    dbName: MONGO_DB_NAME,
    serverSelectionTimeoutMS: CONNECTION_TIMEOUT_MS,
  });
  try {
    await connection.asPromise();
    await connection.close();
    return true;
  } catch {
    await connection.close().catch(() => undefined);
    return false;
  }
}

function buildMongoRepositories(models: MongooseModels, logger: Logger): ContractRepositories {
  const asModel = (model: unknown) => model as Model<Record<string, unknown>>;
  return {
    user: new MongooseRepository<User>(asModel(models.User), 'User', logger),
    agentJob: new MongooseAgentJobRepository(asModel(models.AgentJob), logger),
    jobStep: new MongooseJobStepRepository(asModel(models.AgentJob), logger),
    toolRegistry: new MongooseRepository<ToolRegistryEntry>(asModel(models.ToolRegistry), 'ToolRegistryEntry', logger),
    metricRegistry: new MongooseRepository<MetricRegistryEntry>(asModel(models.MetricRegistry), 'MetricRegistryEntry', logger),
    configRegistry: new MongooseRepository<ConfigRegistryEntry>(asModel(models.ConfigRegistry), 'ConfigRegistryEntry', logger),
    specRegistry: new MongooseRepository<SpecRegistryEntry>(asModel(models.SpecRegistry), 'SpecRegistryEntry', logger),
    auditLog: new MongooseRepository<AuditLog>(asModel(models.AuditLog), 'AuditLog', logger),
    driftEvent: new MongooseDriftEventRepository(asModel(models.AgentJob), logger),
    loadTestResult: new MongooseRepository<LoadTestResult>(asModel(models.LoadTestResult), 'LoadTestResult', logger),
  };
}

async function createMongoHarness(logger: Logger): Promise<ContractHarness> {
  const connection: Connection = mongoose.createConnection(MONGO_URI, { dbName: MONGO_DB_NAME });
  await connection.asPromise();
  const models = createModels(connection);

  return {
    engine: 'mongo',
    repositories: buildMongoRepositories(models, logger),
    cleanup: async () => {
      await Promise.all([
        models.User.deleteMany({}),
        models.AgentJob.deleteMany({}),
        models.ToolRegistry.deleteMany({}),
        models.MetricRegistry.deleteMany({}),
        models.ConfigRegistry.deleteMany({}),
        models.SpecRegistry.deleteMany({}),
        models.AuditLog.deleteMany({}),
        models.LoadTestResult.deleteMany({}),
      ]);
    },
    teardown: async () => {
      await connection.dropDatabase();
      await connection.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Builds the harness for whichever engine `DATA_ENGINE` selects, or
 * returns `null` (after logging a `console.warn` explaining why) when
 * that engine's database isn't reachable. Every `*.contract.test.ts` file
 * calls this once at module scope and gates its `describe` block with
 * `describe.skipIf(!harness)`, matching the existing integration tests'
 * probe-once-and-skip-cleanly convention.
 */
export async function createContractHarness(): Promise<ContractHarness | null> {
  const engine = resolveEngine();
  const logger = pino({ level: 'silent' });

  if (engine === 'postgres') {
    const available = await probePostgres();
    if (!available) {
      console.warn(
        `Skipping data-adapter contract tests (DATA_ENGINE=postgres) — no PostgreSQL reachable at ` +
          `${POSTGRES_HOST}:${POSTGRES_PORT}. Start one (e.g. \`docker compose up -d postgres\`) and ensure ` +
          'migrations are applied (`npm run db:migrate:deploy`) to run these.',
      );
      return null;
    }
    return createPostgresHarness(logger);
  }

  const available = await probeMongo();
  if (!available) {
    console.warn(
      `Skipping data-adapter contract tests (DATA_ENGINE=mongo) — no MongoDB reachable at ${MONGO_URI}. ` +
        'Start one (e.g. `docker compose up -d mongo`) to run these.',
    );
    return null;
  }
  return createMongoHarness(logger);
}
