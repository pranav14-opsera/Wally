import type { Logger } from 'pino';

import { createCloudComputeAdapter, createCloudSecretsAdapter, createCloudStorageAdapter } from './adapters/cloud/index.js';
import { createDataAdapter } from './adapters/data/index.js';
import type { AppContainer } from './container.js';
import { getConfig } from './config/index.js';
import { ConsoleAuditLogger, createLogger } from './logging/index.js';

function initStep<T>(logger: Logger, step: string, configValue: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    logger.error({ step, configValue, err: error }, `Bootstrap failed at step: ${step}`);
    throw error;
  }
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
  const cloudCompute = initStep(logger, 'cloudCompute', config.COMPUTE_RUNNER, () =>
    createCloudComputeAdapter(config.COMPUTE_RUNNER),
  );
  const repositoryFactory = initStep(logger, 'dataAdapter', config.DATA_ENGINE, () =>
    createDataAdapter(config.DATA_ENGINE),
  );

  const container: AppContainer = {
    config,
    logger,
    auditLogger,
    cloudStorage,
    cloudSecrets,
    cloudCompute,
    createRepository: (entityName) => repositoryFactory(entityName),
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
