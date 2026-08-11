import { Schema } from 'mongoose';

import { baseSchemaOptions, defaultStringId } from '../schema-utils.js';

const SECONDS_PER_DAY = 86_400;

export interface AuditLogDoc {
  _id: string;
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  change_details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * A factory, not a plain exported `Schema` like the other entities —
 * the TTL index's `expireAfterSeconds` is computed from
 * `AUDIT_LOG_RETENTION_DAYS` (src/config/schema.ts), and this module
 * intentionally doesn't import `getConfig` itself (keeping the schema
 * layer config-agnostic and independently testable); the caller
 * resolves config and passes the retention value in, deferring config
 * resolution to model-registration time in mongoose-client.ts — the
 * same lazy-resolution pattern the cloud adapter factory uses.
 */
export function createAuditLogSchema(retentionDays: number): Schema<AuditLogDoc> {
  const schema = new Schema<AuditLogDoc>(
    {
      _id: { type: String, default: defaultStringId },
      actor_id: { type: String, default: null },
      action: { type: String, required: true },
      resource_type: { type: String, required: true },
      resource_id: { type: String, default: null },
      change_details: { type: Schema.Types.Mixed, default: null },
      ip_address: { type: String, default: null },
      user_agent: { type: String, default: null },
    },
    baseSchemaOptions(),
  );

  schema.index({ actor_id: 1, created_at: 1 });
  schema.index({ resource_type: 1, resource_id: 1 });
  // The TTL index — automatic retention enforcement per the AC.
  schema.index({ created_at: 1 }, { expireAfterSeconds: retentionDays * SECONDS_PER_DAY });

  return schema;
}
