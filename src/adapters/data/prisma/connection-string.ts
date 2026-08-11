import type { PoolConfig } from 'pg';

// Architecture-mandated connection pooling values (not user-configurable) —
// see the "Database Schema Analysis" architecture artifact: 10 connections
// per process, connections idle for 30s are closed.
const POOL_MAX_CONNECTIONS = 10;
const POOL_IDLE_TIMEOUT_MS = 30_000;
// Prisma's own URL-based pooling knobs (used only by the CLI's internal
// connection, not by the runtime pg.Pool driver adapter below) — kept at
// the same 30s figure for consistency, though "wait for a free connection"
// and "close an idle connection" are different mechanisms.
const CLI_POOL_TIMEOUT_SECONDS = 30;

export interface DatabaseConnectionParams {
  host: string;
  port: string | number;
  user: string;
  password: string;
  database: string;
}

/**
 * Builds a Prisma-compatible PostgreSQL connection string from discrete
 * parts, encoding user/password so special characters (@, /, :, etc.)
 * don't corrupt the URL. Used only by prisma.config.ts for CLI tooling
 * (migrate/generate/validate) — the runtime PrismaClient singleton uses
 * `buildPgPoolConfig` instead, via the @prisma/adapter-pg driver adapter
 * Prisma 7 requires.
 */
export function buildDatabaseUrl(params: DatabaseConnectionParams): string {
  const user = encodeURIComponent(params.user);
  const password = encodeURIComponent(params.password);
  const database = encodeURIComponent(params.database);

  return (
    `postgresql://${user}:${password}@${params.host}:${params.port}/${database}` +
    `?connection_limit=${POOL_MAX_CONNECTIONS}&pool_timeout=${CLI_POOL_TIMEOUT_SECONDS}`
  );
}

/**
 * Builds the `pg.Pool` config the runtime PrismaClient's driver adapter
 * connects through — `max`/`idleTimeoutMillis` are node-postgres's native
 * pool-size and idle-timeout knobs, a more precise match for the
 * architecture's "10 connections per process, 30-second idle timeout"
 * requirement than the URL query params above.
 */
export function buildPgPoolConfig(params: DatabaseConnectionParams): PoolConfig {
  return {
    host: params.host,
    port: typeof params.port === 'string' ? Number(params.port) : params.port,
    user: params.user,
    password: params.password,
    database: params.database,
    max: POOL_MAX_CONNECTIONS,
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
  };
}
