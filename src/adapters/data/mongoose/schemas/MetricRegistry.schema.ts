import { Schema } from 'mongoose';

import { baseSchemaOptions, defaultStringId } from '../schema-utils.js';

export interface MetricRegistryDoc {
  _id: string;
  name: string;
  description: string | null;
  source_query: string;
  dashboard_ref: string | null;
  thresholds: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export const metricRegistrySchema = new Schema<MetricRegistryDoc>(
  {
    _id: { type: String, default: defaultStringId },
    name: { type: String, required: true, unique: true },
    description: { type: String, default: null },
    source_query: { type: String, required: true },
    dashboard_ref: { type: String, default: null },
    thresholds: { type: Schema.Types.Mixed, required: true },
  },
  baseSchemaOptions(),
);
