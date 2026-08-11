import type { BaseEntity } from '../types.js';
import type { DriftType } from '../enums.js';

export interface DriftEvent extends BaseEntity {
  job_id: string;
  metric_id: string;
  source_value: string;
  dashboard_value: string;
  drift_type: DriftType;
  affected_records: Record<string, unknown>;
  detected_at: Date;
}
