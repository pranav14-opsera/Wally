import type { JobStatus } from '../adapters/data/enums.js';

/**
 * Wraps whatever a step handler threw (sync throw or rejected promise —
 * both are caught identically) with the pipeline context needed to debug
 * it: which job, which step, at what index, and when. `originalError` is
 * kept as `unknown` rather than `Error` since a handler can throw
 * anything in JS.
 */
export class StepExecutionError extends Error {
  public constructor(
    public readonly jobId: string,
    public readonly stepName: string,
    public readonly stepIndex: number,
    public readonly originalError: unknown,
    public readonly timestamp: Date = new Date(),
  ) {
    super(
      `Step "${stepName}" (index ${stepIndex}) failed for job ${jobId}: ` +
        (originalError instanceof Error ? originalError.message : String(originalError)),
    );
    this.name = 'StepExecutionError';
  }
}

export class InvalidStateTransitionError extends Error {
  public constructor(
    public readonly from: JobStatus,
    public readonly to: JobStatus,
    validTransitions: readonly JobStatus[],
  ) {
    super(
      `Invalid job status transition: "${from}" -> "${to}". ` +
        (validTransitions.length > 0
          ? `Valid transitions from "${from}": ${validTransitions.join(', ')}.`
          : `"${from}" is a terminal state — no further transitions are valid.`),
    );
    this.name = 'InvalidStateTransitionError';
  }
}

/** Thrown when defineSteps() returns two or more steps with the same name — StepContext keys results by name, so a duplicate would silently overwrite an earlier step's result. */
export class DuplicateStepNameError extends Error {
  public constructor(public readonly stepName: string) {
    super(`defineSteps() returned duplicate step name "${stepName}" — step names must be unique within an agent.`);
    this.name = 'DuplicateStepNameError';
  }
}
