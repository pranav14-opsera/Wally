import { Schema } from 'mongoose';

import { baseSchemaOptions, defaultStringId } from '../schema-utils.js';

export interface ConfigRegistryDoc {
  _id: string;
  key: string;
  value: string;
  data_type: string;
  description: string | null;
  category: string | null;
  created_at: Date;
  updated_at: Date;
}

// unique:true on `key` isn't explicitly called out in WO-010's AC bullet
// list, but it's required for parity with the Postgres schema (WO-008,
// same REQ-002 requirement) — REQ-002's contract test suite (WO-012)
// verifies both engines behave identically, so omitting it here would be
// a real regression, not just an unlisted nice-to-have.
export const configRegistrySchema = new Schema<ConfigRegistryDoc>(
  {
    _id: { type: String, default: defaultStringId },
    key: { type: String, required: true, unique: true },
    value: { type: String, required: true },
    data_type: { type: String, required: true },
    description: { type: String, default: null },
    category: { type: String, default: null },
  },
  baseSchemaOptions(),
);
