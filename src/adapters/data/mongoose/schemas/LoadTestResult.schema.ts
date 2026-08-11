import { Schema } from 'mongoose';

import type { SloVerdict } from '../../enums.js';
import { baseSchemaOptions, defaultStringId } from '../schema-utils.js';

const SLO_VERDICTS: readonly SloVerdict[] = ['pass', 'fail'];

export interface LoadTestResultDoc {
  _id: string;
  job_id: string;
  profile_config: Record<string, unknown>;
  p50_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
  throughput_rps: number;
  error_rate_pct: number;
  slo_verdict: SloVerdict;
  raw_metrics: Record<string, unknown>;
  executed_at: Date;
  created_at: Date;
  updated_at: Date;
}

export const loadTestResultSchema = new Schema<LoadTestResultDoc>(
  {
    _id: { type: String, default: defaultStringId },
    job_id: { type: String, required: true, index: true },
    profile_config: { type: Schema.Types.Mixed, required: true },
    p50_latency_ms: { type: Number, required: true },
    p95_latency_ms: { type: Number, required: true },
    p99_latency_ms: { type: Number, required: true },
    throughput_rps: { type: Number, required: true },
    error_rate_pct: { type: Number, required: true },
    slo_verdict: { type: String, enum: SLO_VERDICTS, required: true },
    raw_metrics: { type: Schema.Types.Mixed, required: true },
    executed_at: { type: Date, default: Date.now },
  },
  baseSchemaOptions(),
);
