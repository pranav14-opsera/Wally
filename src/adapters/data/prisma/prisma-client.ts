import { PrismaPg } from '@prisma/adapter-pg';
import type { Logger } from 'pino';

// Relative imports, not tsconfig path aliases — see the note in
// src/logging/logger.ts for why cross-module imports in src/ use real
// relative paths at runtime.
import { getConfig } from '../../../config/index.js';
import { PrismaClient } from '../../../generated/prisma/client.js';
import { createLogger } from '../../../logging/index.js';
import { buildPgPoolConfig } from './connection-string.js';

const DEV_LOG_LEVELS = ['query', 'info', 'warn', 'error'] as const;
const PROD_LOG_LEVELS = ['error'] as const;

/**
 * The four discrete POSTGRES_* fields are only conditionally required by
 * `envSchema` (required when DATA_ENGINE=postgres, per its `.superRefine`)
 * so their static type is `string | undefined` even though, by the time
 * anything in this module runs, that invariant already holds. This
 * re-asserts it at the one place that needs the narrowed type, with an
 * error message pointing back at the actual missing variable rather than
 * a generic "undefined is not assignable" failure.
 */
function requirePostgresConfig(config: ReturnType<typeof getConfig>): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} {
  const { POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB } = config;
  if (!POSTGRES_HOST || !POSTGRES_PORT || !POSTGRES_USER || !POSTGRES_PASSWORD || !POSTGRES_DB) {
    throw new Error(
      'PrismaClient requires POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, ' +
        'and POSTGRES_DB to all be set (they are required by envSchema when DATA_ENGINE=postgres, ' +
        'so this indicates a config/adapter-selection mismatch, not a missing .env value).',
    );
  }
  return { host: POSTGRES_HOST, port: POSTGRES_PORT, user: POSTGRES_USER, password: POSTGRES_PASSWORD, database: POSTGRES_DB };
}

function createClient(logger: Logger): PrismaClient {
  const config = getConfig();
  const adapter = new PrismaPg(buildPgPoolConfig(requirePostgresConfig(config)));
  const isProduction = config.NODE_ENV === 'production';

  const client = new PrismaClient({
    adapter,
    log: isProduction ? [...PROD_LOG_LEVELS] : [...DEV_LOG_LEVELS],
  });

  logger.info({ nodeEnv: config.NODE_ENV }, 'Prisma client initialized');
  return client;
}

let client: PrismaClient | undefined;
let shutdownHooksRegistered = false;

function registerShutdownHooks(logger: Logger): void {
  if (shutdownHooksRegistered) {
    return;
  }
  shutdownHooksRegistered = true;

  // Disconnect only — deciding whether/when to actually terminate the
  // process belongs to the gateway's own shutdown orchestration (a later
  // WO), not to this adapter. `once` so a second signal during shutdown
  // doesn't attempt a duplicate disconnect.
  const onSignal = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'Received shutdown signal, disconnecting Prisma client');
    disconnectPrismaClient().catch((error: unknown) => {
      logger.error({ err: error, signal }, 'Error disconnecting Prisma client during shutdown');
    });
  };

  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
}

/**
 * Lazily creates (on first call) and returns the process-wide PrismaClient
 * singleton. Every caller shares the same instance and its connection
 * pool — never call `new PrismaClient()` directly elsewhere.
 */
export function getPrismaClient(): PrismaClient {
  if (!client) {
    const logger = createLogger('PrismaClient');
    client = createClient(logger);
    registerShutdownHooks(logger);
  }
  return client;
}

/** Executes a trivial query to confirm the database connection is alive. */
export async function healthCheck(): Promise<boolean> {
  try {
    await getPrismaClient().$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    createLogger('PrismaClient').error({ err: error }, 'Prisma health check failed');
    return false;
  }
}

/** Closes the singleton's connections and clears it so a later `getPrismaClient()` call creates a fresh one. */
export async function disconnectPrismaClient(): Promise<void> {
  if (client) {
    const current = client;
    client = undefined;
    await current.$disconnect();
  }
}
