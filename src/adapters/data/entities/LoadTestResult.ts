import type { BaseEntity } from '../types.js';
import type { SloVerdict } from '../enums.js';

export interface LoadTestResult extends BaseEntity {
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
}
