import type { Logger } from 'pino';

import type { ICloudComputeService, ICloudSecretsService, ICloudStorageService } from './adapters/cloud/index.js';
import type { IRepository } from './adapters/data/index.js';
import type { AppConfig } from './config/index.js';
import type { IAuditLogger } from './logging/index.js';

/**
 * The single typed dependency container assembled by `bootstrap()` (the
 * composition root) and passed to every consumer. No module outside
 * bootstrap.ts may construct adapters directly — this is the only place
 * concrete implementations are bound to these interfaces.
 */
export interface AppContainer {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly auditLogger: IAuditLogger;
  readonly cloudStorage: ICloudStorageService;
  readonly cloudSecrets: ICloudSecretsService;
  readonly cloudCompute: ICloudComputeService;
  createRepository<T extends { id: string }>(entityName: string): IRepository<T>;
}
