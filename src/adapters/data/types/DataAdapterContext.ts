import type { DataEngine } from '../../../config/schema.js';
import type {
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
} from '../index.js';

/**
 * One `IRepository<T>` (or the richer `IAgentJobRepository` for
 * `agentJobs`) per platform entity, named identically regardless of
 * `DATA_ENGINE` — this is the shape both the Postgres/Prisma branch and
 * the Mongo/Mongoose branch of `createDataAdapter` (factory.ts) build,
 * so downstream consumers (registry services, auth module, audit logger)
 * depend only on this interface, never on `PrismaRepository`/
 * `MongooseRepository` directly.
 */
export interface DataAdapterRepositories {
  readonly users: IRepository<User>;
  readonly agentJobs: IAgentJobRepository;
  readonly jobSteps: IRepository<JobStep>;
  readonly toolRegistry: IRepository<ToolRegistryEntry>;
  readonly metricRegistry: IRepository<MetricRegistryEntry>;
  readonly configRegistry: IRepository<ConfigRegistryEntry>;
  readonly specRegistry: IRepository<SpecRegistryEntry>;
  readonly auditLogs: IRepository<AuditLog>;
  readonly driftEvents: IRepository<DriftEvent>;
  readonly loadTestResults: IRepository<LoadTestResult>;
}

/**
 * What `createDataAdapter` (factory.ts) returns: every entity's
 * repository, plus the two operational concerns a live database
 * connection needs at the composition-root level — `healthCheck()` (the
 * factory itself calls this once at boot per WO-013's AC5; also usable
 * later by a `/health` route) and `disconnect()` (bootstrap.ts's
 * SIGTERM/SIGINT handlers, WO-013's AC6).
 */
export interface DataAdapterContext {
  readonly engine: DataEngine;
  readonly repositories: DataAdapterRepositories;
  healthCheck(): Promise<boolean>;
  disconnect(): Promise<void>;
}
