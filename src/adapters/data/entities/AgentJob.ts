import type { BaseEntity } from '../types.js';
import type { AgentType, JobStatus } from '../enums.js';
import type { DriftEvent } from './DriftEvent.js';
import type { JobStep } from './JobStep.js';

export interface AgentJob extends BaseEntity {
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
}

/**
 * The embedded-vs-join abstraction in practice: Postgres/Prisma joins
 * `job_steps` by `job_id`; Mongo/Mongoose stores them as an embedded
 * array on the AgentJob document. Either way, `IAgentJobRepository.
 * findByIdWithSteps` returns this same shape — callers never know which
 * engine produced it.
 */
export interface AgentJobWithSteps extends AgentJob {
  job_steps: JobStep[];
}

/** Same embedded-vs-join abstraction, for Validation Agent jobs' drift events. */
export interface AgentJobWithDriftEvents extends AgentJob {
  drift_events: DriftEvent[];
}
