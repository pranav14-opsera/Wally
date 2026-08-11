import type { Logger } from 'pino';

import { createCloudComputeAdapter, createCloudSecretsAdapter, createCloudStorageAdapter } from './adapters/cloud/index.js';
import { buildDataAdapterConfig, createDataAdapter } from './adapters/data/index.js';
import type { DataAdapterContext } from './adapters/data/index.js';
import type { AppContainer } from './container.js';
import { getConfig } from './config/index.js';
import { ConsoleAuditLogger, createLogger } from './logging/index.js';

// How long graceful shutdown waits for `dataAdapter.disconnect()` (which
// itself waits for in-flight transactions, per Prisma's/Mongoose's own
// disconnect semantics) before giving up and exiting anyway — a hung
// database connection must never prevent the process from ever
// terminating on SIGTERM/SIGINT.
const SHUTDOWN_DISCONNECT_TIMEOUT_MS = 10_000;

function initStep<T>(logger: Logger, step: string, configValue: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    logger.error({ step, configValue, err: error }, `Bootstrap failed at step: ${step}`);
    throw error;
  }
}

/** Runs an adapter's optional `init?()` hook (LocalSecretsAdapter's JWT key generation, LocalComputeRunner's k6 availability check, etc.), if it has one. */
async function runOptionalInit(logger: Logger, step: string, configValue: string, adapter: { init?(): Promise<void> }): Promise<void> {
  if (!adapter.init) {
    return;
  }
  try {
    await adapter.init();
  } catch (error) {
    logger.error({ step, configValue, err: error }, `Bootstrap failed at step: ${step}`);
    throw error;
  }
}

async function initStepAsync<T>(logger: Logger, step: string, configValue: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    logger.error({ step, configValue, err: error }, `Bootstrap failed at step: ${step}`);
    throw error;
  }
}

let shutdownHooksRegistered = false;

/**
 * Registers SIGTERM/SIGINT handlers that disconnect the active database
 * connection before the process exits (AC6) — `once`, guarded by a
 * module-level flag (not just `process.once`'s own once-per-signal
 * semantics) so a failed `bootstrap()` call that gets retried (see
 * `bootstrap()`'s doc comment below) never registers a second pair of
 * handlers pointed at a stale `dataAdapter` from the failed attempt.
 */
function registerShutdownHooks(logger: Logger, dataAdapter: DataAdapterContext): void {
  if (shutdownHooksRegistered) {
    return;
  }
  shutdownHooksRegistered = true;

  const onSignal = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'Received shutdown signal, disconnecting data adapter');
    const timeout = new Promise<void>((resolve) => {
      setTimeout(() => {
        logger.warn(
          { signal, timeoutMs: SHUTDOWN_DISCONNECT_TIMEOUT_MS },
          'Data adapter disconnect did not complete within the shutdown timeout — exiting anyway',
        );
        resolve();
      }, SHUTDOWN_DISCONNECT_TIMEOUT_MS);
    });

    Promise.race([
      dataAdapter.disconnect().then(() => logger.info({ signal }, 'Data adapter disconnected')),
      timeout,
    ])
      .catch((error: unknown) => {
        logger.error({ err: error, signal }, 'Error disconnecting data adapter during shutdown');
      })
      .finally(() => {
        process.exit(0);
      });
  };

  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
}

async function doBootstrap(): Promise<Readonly<AppContainer>> {
  const config = getConfig();
  const logger = createLogger('bootstrap');
  const auditLogger = new ConsoleAuditLogger(logger);

  const cloudStorage = initStep(logger, 'cloudStorage', config.CLOUD_PROVIDER, () =>
    createCloudStorageAdapter(config.CLOUD_PROVIDER),
  );
  const cloudSecrets = initStep(logger, 'cloudSecrets', config.CLOUD_PROVIDER, () =>
    createCloudSecretsAdapter(config.CLOUD_PROVIDER),
  );
  await runOptionalInit(logger, 'cloudSecrets.init', config.CLOUD_PROVIDER, cloudSecrets);

  const cloudCompute = initStep(logger, 'cloudCompute', config.COMPUTE_RUNNER, () =>
    createCloudComputeAdapter(config.COMPUTE_RUNNER),
  );
  await runOptionalInit(logger, 'cloudCompute.init', config.COMPUTE_RUNNER, cloudCompute);
  const dataAdapter = await initStepAsync(logger, 'dataAdapter', config.DATA_ENGINE, () =>
    createDataAdapter(buildDataAdapterConfig(config.DATA_ENGINE)),
  );
  registerShutdownHooks(logger, dataAdapter);

  const container: AppContainer = {
    config,
    logger,
    auditLogger,
    cloudStorage,
    cloudSecrets,
    cloudCompute,
    dataAdapter,
  };

  const frozen = Object.freeze(container);
  logger.info(
    {
      cloudProvider: config.CLOUD_PROVIDER,
      dataEngine: config.DATA_ENGINE,
      computeRunner: config.COMPUTE_RUNNER,
    },
    'Wally bootstrap complete',
  );

  return frozen;
}

let containerPromise: Promise<Readonly<AppContainer>> | undefined;

/**
 * The composition root. Resolves config, instantiates adapters via their
 * factories, and assembles the immutable `AppContainer`. Safe to call
 * concurrently: every caller awaits the same in-flight initialization
 * rather than racing to build separate containers. If initialization
 * fails, the guard resets so a subsequent call can retry (e.g. after a
 * transient adapter connection failure) instead of being permanently
 * poisoned by the first failed attempt.
 */
export async function bootstrap(): Promise<Readonly<AppContainer>> {
  if (!containerPromise) {
    containerPromise = doBootstrap().catch((error: unknown) => {
      containerPromise = undefined;
      throw error;
    });
  }

  return containerPromise;
}
