import { Schema } from 'mongoose';

import { baseSchemaOptions, defaultStringId } from '../schema-utils.js';

export interface ToolRegistryDoc {
  _id: string;
  name: string;
  description: string | null;
  type: string;
  base_url: string;
  auth_type: string;
  endpoints: Array<Record<string, unknown>>;
  credential_ref: string | null;
  health_status: string;
  last_health_check: Date | null;
  created_at: Date;
  updated_at: Date;
}

export const toolRegistrySchema = new Schema<ToolRegistryDoc>(
  {
    _id: { type: String, default: defaultStringId },
    name: { type: String, required: true, unique: true },
    description: { type: String, default: null },
    type: { type: String, required: true },
    base_url: { type: String, required: true },
    auth_type: { type: String, required: true },
    endpoints: { type: Schema.Types.Mixed, required: true },
    credential_ref: { type: String, default: null },
    health_status: { type: String, default: 'unknown' },
    last_health_check: { type: Date, default: null },
  },
  baseSchemaOptions(),
);
