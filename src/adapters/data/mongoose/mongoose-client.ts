import mongoose from 'mongoose';
import type { Connection } from 'mongoose';
import type { Logger } from 'pino';

import { getConfig } from '../../../config/index.js';
import { createLogger } from '../../../logging/index.js';
import type { MongooseModels } from './models.js';
import { createModels } from './models.js';

const MAX_POOL_SIZE = 10;
const CONNECT_TIMEOUT_MS = 30_000;
const SERVER_SELECTION_TIMEOUT_MS = 5_000;

/**
 * MONGO_URI/MONGO_INITDB_DATABASE are only conditionally required by
 * envSchema (required when DATA_ENGINE=mongo), so their static type is
 * `string | undefined` even though, by the time anything in this module
 * runs, that invariant already holds — same pattern as
 * prisma-client.ts's `requirePostgresConfig`.
 */
function requireMongoConfig(config: ReturnType<typeof getConfig>): { uri: string; dbName: string } {
  const { MONGO_URI, MONGO_INITDB_DATABASE } = config;
  if (!MONGO_URI || !MONGO_INITDB_DATABASE) {
    throw new Error(
      'Mongoose connection requires MONGO_URI and MONGO_INITDB_DATABASE to both be set (they are ' +
        'required by envSchema when DATA_ENGINE=mongo, so this indicates a config/adapter-selection ' +
        'mismatch, not a missing .env value).',
    );
  }
  return { uri: MONGO_URI, dbName: MONGO_INITDB_DATABASE };
}

async function connect(logger: Logger): Promise<Connection> {
  const { uri, dbName } = requireMongoConfig(getConfig());

  // A dedicated connection, not the global `mongoose` default connection
  // — keeps this module's connection lifecycle self-contained rather
  // than mutating process-wide shared state other code/tests might also
  // touch via `import mongoose from 'mongoose'`.
  const connection = mongoose.createConnection(uri, {
    dbName,
    maxPoolSize: MAX_POOL_SIZE,
    connectTimeoutMS: CONNECT_TIMEOUT_MS,
    serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
  });

  connection.on('error', (error: Error) => logger.error({ err: error }, 'Mongoose connection error'));
  connection.on('disconnected', () => logger.warn('Mongoose connection disconnected'));
  connection.on('reconnected', () => logger.info('Mongoose connection reconnected'));

  await connection.asPromise();
  logger.info({ dbName }, 'Mongoose connection established');
  return connection;
}

let connectionPromise: Promise<Connection> | undefined;
let modelsCache: MongooseModels | undefined;
let shutdownHooksRegistered = false;

function registerShutdownHooks(logger: Logger): void {
  if (shutdownHooksRegistered) {
    return;
  }
  shutdownHooksRegistered = true;

  // Disconnect only — deciding whether/when to terminate the process
  // belongs to the gateway's own shutdown orchestration (a later WO),
  // matching prisma-client.ts's identical rationale.
  const onSignal = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'Received shutdown signal, disconnecting Mongoose');
    disconnectMongoose().catch((error: unknown) => {
      logger.error({ err: error, signal }, 'Error disconnecting Mongoose during shutdown');
    });
  };

  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
}

/** Lazily connects (on first call) and returns the process-wide Mongoose connection singleton. */
export function getMongooseConnection(): Promise<Connection> {
  if (!connectionPromise) {
    const logger = createLogger('MongooseClient');
    connectionPromise = connect(logger).catch((error: unknown) => {
      connectionPromise = undefined;
      throw error;
    });
    registerShutdownHooks(logger);
  }
  return connectionPromise;
}

/** Lazily registers (on first call) and returns every Mongoose model, bound to the singleton connection. */
export async function getMongooseModels(): Promise<MongooseModels> {
  if (!modelsCache) {
    const connection = await getMongooseConnection();
    modelsCache = createModels(connection);
  }
  return modelsCache;
}

/** Executes a trivial admin command to confirm the database connection is alive. */
export async function healthCheck(): Promise<boolean> {
  try {
    const connection = await getMongooseConnection();
    if (!connection.db) {
      return false;
    }
    const result: unknown = await connection.db.admin().ping();
    return typeof result === 'object' && result !== null && 'ok' in result && Boolean((result as { ok: unknown }).ok);
  } catch (error) {
    createLogger('MongooseClient').error({ err: error }, 'Mongoose health check failed');
    return false;
  }
}

/** Closes the singleton's connection and clears cached state so a later call reconnects fresh. */
export async function disconnectMongoose(): Promise<void> {
  if (connectionPromise) {
    const current = await connectionPromise;
    connectionPromise = undefined;
    modelsCache = undefined;
    await current.close();
  }
}
