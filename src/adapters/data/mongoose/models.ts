import type { Connection, Model } from 'mongoose';

import { getConfig } from '../../../config/index.js';
import type { AgentJobDoc } from './schemas/AgentJob.schema.js';
import { agentJobSchema } from './schemas/AgentJob.schema.js';
import type { AuditLogDoc } from './schemas/AuditLog.schema.js';
import { createAuditLogSchema } from './schemas/AuditLog.schema.js';
import type { ConfigRegistryDoc } from './schemas/ConfigRegistry.schema.js';
import { configRegistrySchema } from './schemas/ConfigRegistry.schema.js';
import type { LoadTestResultDoc } from './schemas/LoadTestResult.schema.js';
import { loadTestResultSchema } from './schemas/LoadTestResult.schema.js';
import type { MetricRegistryDoc } from './schemas/MetricRegistry.schema.js';
import { metricRegistrySchema } from './schemas/MetricRegistry.schema.js';
import type { SpecRegistryDoc } from './schemas/SpecRegistry.schema.js';
import { specRegistrySchema } from './schemas/SpecRegistry.schema.js';
import type { ToolRegistryDoc } from './schemas/ToolRegistry.schema.js';
import { toolRegistrySchema } from './schemas/ToolRegistry.schema.js';
import type { UserDoc } from './schemas/User.schema.js';
import { userSchema } from './schemas/User.schema.js';

export interface MongooseModels {
  User: Model<UserDoc>;
  AgentJob: Model<AgentJobDoc>;
  ToolRegistry: Model<ToolRegistryDoc>;
  MetricRegistry: Model<MetricRegistryDoc>;
  ConfigRegistry: Model<ConfigRegistryDoc>;
  SpecRegistry: Model<SpecRegistryDoc>;
  AuditLog: Model<AuditLogDoc>;
  LoadTestResult: Model<LoadTestResultDoc>;
}

/**
 * Registers every model on `connection` (never the global `mongoose`
 * default connection — see mongoose-client.ts for why) and returns them
 * as a single object. `AuditLog`'s schema is built here, not imported
 * as a constant like the others, since its TTL index depends on
 * `AUDIT_LOG_RETENTION_DAYS` — resolved from config at this call site,
 * not at module load time.
 */
export function createModels(connection: Connection): MongooseModels {
  return {
    User: connection.model('User', userSchema),
    AgentJob: connection.model('AgentJob', agentJobSchema),
    ToolRegistry: connection.model('ToolRegistry', toolRegistrySchema),
    MetricRegistry: connection.model('MetricRegistry', metricRegistrySchema),
    ConfigRegistry: connection.model('ConfigRegistry', configRegistrySchema),
    SpecRegistry: connection.model('SpecRegistry', specRegistrySchema),
    AuditLog: connection.model('AuditLog', createAuditLogSchema(getConfig().AUDIT_LOG_RETENTION_DAYS)),
    LoadTestResult: connection.model('LoadTestResult', loadTestResultSchema),
  };
}
