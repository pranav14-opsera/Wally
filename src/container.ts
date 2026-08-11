import type { Logger } from 'pino';

import type { ICloudComputeService, ICloudSecretsService, ICloudStorageService } from './adapters/cloud/index.js';
import type { DataAdapterContext } from './adapters/data/index.js';
import type { AppConfig } from './config/index.js';
import type { IAuditLogger } from './logging/index.js';

/**
 * The single typed dependency container assembled by `bootstrap()` (the
 * composition root) and passed to every consumer. No module outside
 * bootstrap.ts may construct adapters directly — this is the only place
 * concrete implementations are bound to these interfaces.
 *
 * `dataAdapter` (WO-013) is the one connected, health-checked
 * `DataAdapterContext` for whichever engine `DATA_ENGINE` selected —
 * every entity's repository plus `disconnect()` for graceful shutdown.
 * Downstream consumers depend only on `DataAdapterRepositories`'/
 * `IRepository<T>`'s interfaces, never on `PrismaRepository`/
 * `MongooseRepository` directly.
 */
export interface AppContainer {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly auditLogger: IAuditLogger;
  readonly cloudStorage: ICloudStorageService;
  readonly cloudSecrets: ICloudSecretsService;
  readonly cloudCompute: ICloudComputeService;
  readonly dataAdapter: DataAdapterContext;
}
