import type { BaseEntity } from '../types.js';
import type { StepStatus } from '../enums.js';

export interface JobStep extends BaseEntity {
  job_id: string;
  step_order: number;
  step_name: string;
  status: StepStatus;
  input_data: Record<string, unknown> | null;
  output_data: Record<string, unknown> | null;
  error_message: string | null;
  duration_ms: number | null;
  started_at: Date | null;
  completed_at: Date | null;
}
