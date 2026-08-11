import { Schema } from 'mongoose';

import type { AgentType, JobStatus } from '../../enums.js';
import { baseSchemaOptions, defaultStringId } from '../schema-utils.js';
import type { DriftEventDoc } from './DriftEvent.schema.js';
import { driftEventSchema } from './DriftEvent.schema.js';
import type { JobStepDoc } from './JobStep.schema.js';
import { jobStepSchema } from './JobStep.schema.js';

const AGENT_TYPES: readonly AgentType[] = ['integration', 'validation', 'load_testing', 'api_lifecycle'];
const JOB_STATUSES: readonly JobStatus[] = ['queued', 'running', 'paused', 'completed', 'failed', 'cancelled'];

// Defensive caps on the embedded arrays, well under MongoDB's 16MB
// per-document limit — not an exact byte budget (that depends on each
// step/event's own input_data/output_data/affected_records payload
// size, which varies), but a guard that fails fast with a clear message
// instead of an opaque "document too large" error from the driver. A
// real workflow hitting this cap almost certainly needs re-architecting
// (e.g. splitting into sub-jobs), not a higher cap.
const MAX_JOB_STEPS = 1000;
const MAX_DRIFT_EVENTS = 5000;

export interface AgentJobDoc {
  _id: string;
  user_id: string;
  agent_type: AgentType;
  status: JobStatus;
  input_params: Record<string, unknown>;
  result_summary: Record<string, unknown> | null;
  current_step: number;
  total_steps: number;
  error_message: string | null;
  queued_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  // Field names match AgentJobWithSteps.job_steps / AgentJobWithDriftEvents.drift_events
  // (WO-007) exactly, not WO-010's implementation_steps' looser "steps" —
  // cross-engine callers must see the identical shape regardless of DATA_ENGINE.
  job_steps: JobStepDoc[];
  drift_events: DriftEventDoc[];
  created_at: Date;
  updated_at: Date;
}

export const agentJobSchema = new Schema<AgentJobDoc>(
  {
    _id: { type: String, default: defaultStringId },
    user_id: { type: String, required: true },
    agent_type: { type: String, enum: AGENT_TYPES, required: true },
    status: { type: String, enum: JOB_STATUSES, default: 'queued' },
    input_params: { type: Schema.Types.Mixed, default: {} },
    result_summary: { type: Schema.Types.Mixed, default: null },
    current_step: { type: Number, default: 0 },
    total_steps: { type: Number, required: true },
    error_message: { type: String, default: null },
    queued_at: { type: Date, default: Date.now },
    started_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
    job_steps: {
      type: [jobStepSchema],
      default: [],
      validate: {
        validator: (value: unknown[]) => value.length <= MAX_JOB_STEPS,
        message: `job_steps exceeds the defensive cap of ${MAX_JOB_STEPS} embedded steps (MongoDB's 16MB document limit)`,
      },
    },
    drift_events: {
      type: [driftEventSchema],
      default: [],
      validate: {
        validator: (value: unknown[]) => value.length <= MAX_DRIFT_EVENTS,
        message: `drift_events exceeds the defensive cap of ${MAX_DRIFT_EVENTS} embedded events (MongoDB's 16MB document limit)`,
      },
    },
  },
  baseSchemaOptions(),
);

agentJobSchema.index({ agent_type: 1, status: 1, created_at: 1 });
agentJobSchema.index({ user_id: 1, created_at: 1 });
