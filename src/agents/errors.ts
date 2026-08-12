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
    /** Overrides the generated message — for call sites with a stricter precondition than the general state machine (e.g. BaseAgent.resume() requires "paused" specifically, even though the machine also allows other states to transition to "running"). */
    reasonOverride?: string,
  ) {
    super(
      reasonOverride ??
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

/** Thrown when a step's result can't be JSON-serialized for the memoization cache (WO-031) — a circular reference (caught via JSON.stringify's own error) or a function value anywhere in the result (JSON.stringify would otherwise silently drop it instead of erroring, which is worse: silent data loss on resume). */
export class StepSerializationError extends Error {
  public constructor(
    public readonly jobId: string,
    public readonly stepOrder: number,
    public readonly cause: unknown,
  ) {
    super(
      `Step result at index ${stepOrder} for job ${jobId} could not be serialized for caching: ` +
        (cause instanceof Error ? cause.message : String(cause)),
    );
    this.name = 'StepSerializationError';
  }
}

/** Thrown when the cache backend's atomic checkpoint transaction (result + checkpoint pointer) is aborted or a queued command within it fails — per this WO's constraint, a step is never considered "checkpointed" unless both commit together. Not named after any specific provider (agent code stays provider-agnostic, per the zero-hardcoding rule) even though the concrete adapter behind `IRedisClient` happens to be Redis today. */
export class TransactionFailedError extends Error {
  public constructor(
    public readonly jobId: string,
    public readonly stepOrder: number,
    public readonly cause?: unknown,
  ) {
    super(
      `Checkpoint transaction failed while caching step ${stepOrder} for job ${jobId}` +
        (cause instanceof Error ? `: ${cause.message}` : cause !== undefined ? `: ${String(cause)}` : ' (transaction aborted).'),
    );
    this.name = 'TransactionFailedError';
  }
}
