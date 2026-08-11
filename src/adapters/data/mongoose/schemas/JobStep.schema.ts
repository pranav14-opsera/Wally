import { Schema } from 'mongoose';

import type { StepStatus } from '../../enums.js';
import { baseSchemaOptions, defaultStringId } from '../schema-utils.js';

const STEP_STATUSES: readonly StepStatus[] = ['pending', 'running', 'completed', 'failed', 'skipped'];

/**
 * Raw Mongoose document shape for an embedded job step — deliberately
 * has no `job_id`, unlike the `JobStep` domain entity (WO-007). Embedded
 * inside `AgentJob.job_steps`, the parent document's own `_id` already
 * identifies which job a step belongs to; storing `job_id` redundantly
 * on every element would just be denormalized bloat with no query the
 * embedded design needs it for. `MongooseRepository` (WO-011) is
 * responsible for populating `job_id` from the parent when mapping an
 * embedded step out to the full `JobStep` type.
 */
export interface JobStepDoc {
  _id: string;
  step_order: number;
  step_name: string;
  status: StepStatus;
  input_data: Record<string, unknown> | null;
  output_data: Record<string, unknown> | null;
  error_message: string | null;
  duration_ms: number | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export const jobStepSchema = new Schema<JobStepDoc>(
  {
    _id: { type: String, default: defaultStringId },
    step_order: { type: Number, required: true },
    step_name: { type: String, required: true },
    status: { type: String, enum: STEP_STATUSES, default: 'pending' },
    input_data: { type: Schema.Types.Mixed, default: null },
    output_data: { type: Schema.Types.Mixed, default: null },
    error_message: { type: String, default: null },
    duration_ms: { type: Number, default: null },
    started_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
  },
  baseSchemaOptions(),
);
