import { Schema } from 'mongoose';

import { baseSchemaOptions, defaultStringId } from '../schema-utils.js';

export interface ToolRegistryDoc {
  _id: string;
  name: string;
  description: string;
  spec_url: string | null;
  endpoints: Record<string, unknown>;
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
    description: { type: String, required: true },
    spec_url: { type: String, default: null },
    endpoints: { type: Schema.Types.Mixed, required: true },
    credential_ref: { type: String, default: null },
    health_status: { type: String, default: 'unknown' },
    last_health_check: { type: Date, default: null },
  },
  baseSchemaOptions(),
);
