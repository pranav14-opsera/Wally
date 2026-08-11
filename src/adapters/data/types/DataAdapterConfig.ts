import type { DataEngine } from '../../../config/schema.js';

// Defaults mirror the values already hardcoded in prisma-client.ts
// (POOL_MAX_CONNECTIONS, POOL_IDLE_TIMEOUT_MS) and mongoose-client.ts
// (MAX_POOL_SIZE, CONNECT_TIMEOUT_MS) — this config object doesn't
// replace those per-engine client modules' own connection setup, it's
// the shape the factory (factory.ts) uses to decide *which* engine to
// build and how long to wait for its post-connect health check.
export const DEFAULT_POOL_SIZE = 10;
export const DEFAULT_CONNECTION_TIMEOUT_MS = 30_000;
export const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 5_000;

/**
 * Configuration the data adapter factory (`createDataAdapter`) needs to
 * build a `DataAdapterContext` for one engine. Deliberately does *not*
 * carry a raw connection URL string: this codebase's actual established
 * connection config is per-engine (Postgres: discrete POSTGRES_HOST/PORT/
 * USER/PASSWORD/DB fields consumed by `@prisma/adapter-pg`'s pool config,
 * WO-008; Mongo: `MONGO_URI` + `MONGO_INITDB_DATABASE`, WO-010) — both
 * already validated by `envSchema` (src/config/schema.ts) before
 * `createDataAdapter` ever runs, so re-deriving a single generic
 * "connectionUrl" here would be a second, redundant source of truth for
 * data this object doesn't actually need to carry.
 */
export interface DataAdapterConfig {
  readonly engine: DataEngine;
  readonly poolSize: number;
  readonly connectionTimeoutMs: number;
  readonly healthCheckTimeoutMs: number;
}

export function buildDataAdapterConfig(
  engine: DataEngine,
  overrides: Partial<Omit<DataAdapterConfig, 'engine'>> = {},
): DataAdapterConfig {
  return {
    engine,
    poolSize: overrides.poolSize ?? DEFAULT_POOL_SIZE,
    connectionTimeoutMs: overrides.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS,
    healthCheckTimeoutMs: overrides.healthCheckTimeoutMs ?? DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
  };
}
