import type { AgentType, JobStatus } from '../adapters/data/enums.js';
import type { StepContext } from './step-context.js';

// Re-exported, not redefined: src/adapters/data/enums.ts's JobStatus is
// the single source of truth for job status values, since AgentJob.status
// (the record BaseAgent.execute() reads/writes) is already typed against
// it — a second, agents-local JobStatus would drift from that one.
export type { AgentType, JobStatus } from '../adapters/data/enums.js';

/** Per-step retry configuration. Execution of retries is WO-031's scope (step memoization/crash-resume) — this WO only carries the shape through the type so downstream code doesn't need a breaking change to add it. */
export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

/**
 * One unit of work in an agent's pipeline. `handler` receives the
 * `StepContext` accumulated from every prior step (never a plain object —
 * see step-context.ts for why) and returns this step's own result, which
 * BaseAgent then folds into the context for the next step.
 */
export interface AgentStep<TInput extends Record<string, unknown> = Record<string, unknown>, TResult = unknown> {
  name: string;
  handler: (context: StepContext<TInput>) => Promise<TResult> | TResult;
  retryPolicy?: RetryPolicy;
}

/** Per-agent-type settings injected at construction — never bare literals inside BaseAgent (zero-hardcoding constraint). */
export interface AgentJobConfig {
  agentType: AgentType;
  maxRetries: number;
  timeoutMs: number;
}

export interface JobResult<TOutput = unknown> {
  status: JobStatus;
  data: TOutput | null;
  error: Error | null;
}
