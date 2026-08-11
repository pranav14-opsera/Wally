import { Schema } from 'mongoose';

import type { DriftType } from '../../enums.js';
import { baseSchemaOptions, defaultStringId } from '../schema-utils.js';

const DRIFT_TYPES: readonly DriftType[] = ['value_mismatch', 'missing_metric', 'threshold_exceeded'];

/**
 * Embedded inside `AgentJob.drift_events` for Validation Agent jobs.
 * Unlike `job_id` (omitted — see JobStep.schema.ts), `metric_id` stays
 * explicit: MetricRegistry remains its own top-level collection, so a
 * drift event genuinely references another document, not its own
 * container.
 */
export interface DriftEventDoc {
  _id: string;
  metric_id: string;
  source_value: number;
  dashboard_value: number;
  drift_type: DriftType;
  affected_records: Record<string, unknown>;
  detected_at: Date;
  created_at: Date;
  updated_at: Date;
}

export const driftEventSchema = new Schema<DriftEventDoc>(
  {
    _id: { type: String, default: defaultStringId },
    metric_id: { type: String, required: true },
    source_value: { type: Number, required: true },
    dashboard_value: { type: Number, required: true },
    drift_type: { type: String, enum: DRIFT_TYPES, required: true },
    affected_records: { type: Schema.Types.Mixed, required: true },
    detected_at: { type: Date, default: Date.now },
  },
  baseSchemaOptions(),
);
