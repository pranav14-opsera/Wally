import { Schema } from 'mongoose';

import { baseSchemaOptions, defaultStringId } from '../schema-utils.js';

export interface SpecRegistryDoc {
  _id: string;
  api_name: string;
  version: string;
  spec_content: Record<string, unknown>;
  checksum: string;
  created_at: Date;
  updated_at: Date;
}

export const specRegistrySchema = new Schema<SpecRegistryDoc>(
  {
    _id: { type: String, default: defaultStringId },
    api_name: { type: String, required: true },
    version: { type: String, required: true },
    spec_content: { type: Schema.Types.Mixed, required: true },
    checksum: { type: String, required: true },
  },
  baseSchemaOptions(),
);

specRegistrySchema.index({ api_name: 1, version: 1 }, { unique: true });
