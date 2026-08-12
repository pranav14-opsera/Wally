import type { Logger } from 'pino';

import type { AgentJob } from '../adapters/data/entities/AgentJob.js';
import type { IRedisClient } from '../adapters/redis/interfaces/IRedisClient.js';
import { DuplicateStepNameError, InvalidStateTransitionError, StepExecutionError } from './errors.js';
import type { JobPersistence } from './job-persistence.js';
import type { StepMemoizer } from './memoization.js';
import { assertTransition } from './state-machine.js';
import { StepContext } from './step-context.js';
import type { AgentJobConfig, AgentStep, JobResult, JobStatus } from './types.js';

/**
 * Foundational execution framework every Wally agent (Integration,
 * Validation, Load Testing, API Lifecycle) extends. Depends only on
 * adapter interfaces (`JobPersistence`/`StepMemoizer`, themselves built
 * on `IRepository`/`IRedisClient`) and `Logger` — never a concrete
 * adapter, the gateway, or a registry implementation (dependency
 * inversion, per WO-029's constraint, still honored here).
 *
 * `redis` is still accepted and validated directly (not only through
 * `stepMemoizer`) for SSE progress publishing (WO-033), which isn't a
 * memoization concern and doesn't belong on `StepMemoizer`.
 */
export abstract class BaseAgent<TInput extends Record<string, unknown> = Record<string, unknown>, TOutput = unknown> {
  protected constructor(
    protected readonly jobPersistence: JobPersistence,
    protected readonly stepMemoizer: StepMemoizer,
    protected readonly redis: IRedisClient,
    protected readonly logger: Logger,
    protected readonly config: AgentJobConfig,
  ) {
    if (!jobPersistence) {
      throw new Error('BaseAgent requires a jobPersistence — received null/undefined.');
    }
    if (!stepMemoizer) {
      throw new Error('BaseAgent requires a stepMemoizer — received null/undefined.');
    }
    if (!redis) {
      throw new Error('BaseAgent requires a redis client — received null/undefined.');
    }
    if (!logger) {
      throw new Error('BaseAgent requires a logger — received null/undefined.');
    }
    if (!config) {
      throw new Error('BaseAgent requires an AgentJobConfig — received null/undefined.');
    }
  }

  /** The concrete agent's pipeline, in execution order. Must not return two steps with the same `name` — validated by `execute()` before any step runs. */
  protected abstract defineSteps(): Array<AgentStep<TInput>>;

  /** Invoked after each step resolves successfully (cached or freshly executed). Default is a no-op; override to observe progress (e.g. publish an SSE event, WO-033). */
  protected onStepComplete(_stepName: string, _result: unknown, _context: StepContext<TInput>): void | Promise<void> {
    // Intentionally empty — override point for subclasses.
  }

  /** Invoked once, after every step has completed successfully. */
  protected onJobComplete(_jobId: string, _result: JobResult<TOutput>): void | Promise<void> {
    // Intentionally empty — override point for subclasses.
  }

  /** Invoked once, when a step throws (sync or async), a checkpoint write fails, or the job cannot start. */
  protected onJobFailed(_jobId: string, _error: Error): void | Promise<void> {
    // Intentionally empty — override point for subclasses.
  }

  /**
   * Runs every step of `defineSteps()` in order against `input`. Before
   * each step, checks `stepMemoizer` for a cached result (from a prior
   * run of the same `jobId` that crashed or was paused) and skips
   * execution on a hit — this is what makes crash-resume work: calling
   * `execute()` again with the same `jobId` picks up from the last
   * checkpointed step instead of restarting from scratch.
   *
   * Resolves (never rejects) with a `status: 'failed'` or `status:
   * 'paused'` result for expected outcomes — those carry data, they
   * aren't programming errors. It DOES throw for usage errors: an
   * unknown `jobId`, an already-terminal job, or a `defineSteps()` that
   * returns duplicate names.
   */
  public async execute(jobId: string, input: TInput): Promise<JobResult<TOutput>> {
    const job = await this.jobPersistence.getJob(jobId);
    if (!job) {
      throw new Error(`BaseAgent.execute: no AgentJob found with id "${jobId}".`);
    }

    const isResume = job.status === 'paused';
    assertTransition(job.status, 'running');
    await this.jobPersistence.updateJobStatus(jobId, 'running', isResume ? {} : { started_at: new Date() });
    await this.stepMemoizer.clearPaused(jobId);

    const steps = this.defineSteps();
    this.assertUniqueStepNames(steps);

    if (steps.length === 0) {
      this.logger.warn({ jobId, agentType: this.config.agentType }, 'defineSteps() returned no steps — completing job immediately with an empty result.');
      return this.completeJob(jobId, new StepContext<TInput>(input));
    }

    if (isResume && (await this.stepMemoizer.getCheckpoint(jobId)) === null) {
      this.logger.warn({ jobId }, 'Resuming a paused job but no cached checkpoint was found (the memoization TTL likely expired) — re-executing from step 0.');
    }

    const context = new StepContext<TInput>(input);

    for (const [index, stepDef] of steps.entries()) {
      if (await this.stepMemoizer.isPaused(jobId)) {
        await this.jobPersistence.updateJobStatus(jobId, 'paused');
        this.logger.info({ jobId, resumeFromStepIndex: index }, 'Job paused between steps');
        return { status: 'paused', data: null, error: null };
      }

      let result: unknown;
      try {
        result = await this.resolveStep(job, stepDef, index, context);
      } catch (error) {
        const wrapped =
          error instanceof StepExecutionError ? error : new StepExecutionError(jobId, stepDef.name, index, error);
        return this.failJob(jobId, wrapped);
      }

      context.set(stepDef.name, result);
      await this.jobPersistence.updateJobStatus(jobId, 'running', { current_step: index + 1 });
      await this.onStepComplete(stepDef.name, result, context);
    }

    return this.completeJob(jobId, context);
  }

  /** Sets the paused flag; the running `execute()` loop (if any) observes it at the start of its next iteration and stops after the step in progress completes — this method itself never interrupts a step mid-execution. Safe to call between steps or before a job has even started. */
  public async pause(jobId: string): Promise<void> {
    const job = await this.jobPersistence.getJob(jobId);
    if (!job) {
      throw new Error(`BaseAgent.pause: no AgentJob found with id "${jobId}".`);
    }
    await this.stepMemoizer.setPaused(jobId);
  }

  /** Resumes a paused job — thin wrapper over `execute()`, which already skips memoized steps. Rejects with `InvalidStateTransitionError` unless the job's persisted status is exactly "paused" (stricter than the general state machine, which also permits e.g. "queued" -> "running"). */
  public async resume(jobId: string, input: TInput): Promise<JobResult<TOutput>> {
    const job = await this.jobPersistence.getJob(jobId);
    if (!job) {
      throw new Error(`BaseAgent.resume: no AgentJob found with id "${jobId}".`);
    }
    if (job.status !== 'paused') {
      throw new InvalidStateTransitionError(
        job.status,
        'running',
        [],
        `BaseAgent.resume: job ${jobId} is not paused (current status: "${job.status}") — resume() requires status "paused".`,
      );
    }
    return this.execute(jobId, input);
  }

  /** Cache hit: returns the memoized result without invoking the step handler. Cache miss: runs the step, then atomically checkpoints the result via `stepMemoizer.setStepResult`. */
  private async resolveStep<TResult>(
    job: AgentJob,
    stepDef: AgentStep<TInput, TResult>,
    index: number,
    context: StepContext<TInput>,
  ): Promise<TResult> {
    if (await this.stepMemoizer.hasStepResult(job.id, index)) {
      const cached = await this.stepMemoizer.getStepResult<TResult>(job.id, index);
      this.logger.info({ jobId: job.id, stepName: stepDef.name, stepIndex: index }, 'Step result served from memoization cache — skipping execution');
      return cached as TResult;
    }

    return this.step(job, stepDef, index, context);
  }

  /**
   * Persists a JobStep record for `stepDef`, runs its handler, then
   * checkpoints the result in Redis (MULTI/EXEC, via `stepMemoizer`)
   * BEFORE marking the JobStep row completed in the database — in that
   * order, deliberately: if the process crashes between the handler
   * returning and the Redis transaction committing, the checkpoint was
   * never written, so `hasStepResult()` still reports a cache miss on
   * resume and the step correctly re-executes rather than the DB and
   * cache disagreeing about whether it "really" completed. Throws
   * `StepExecutionError` on any failure — handler error, serialization
   * error, or transaction failure alike — callers (only `resolveStep()`)
   * decide how to translate that into job-level state.
   */
  protected async step<TResult>(
    job: AgentJob,
    stepDef: AgentStep<TInput, TResult>,
    index: number,
    context: StepContext<TInput>,
  ): Promise<TResult> {
    const startedAt = new Date();
    const stepRecord = await this.jobPersistence.createJobStep(job.id, index, stepDef.name, context.toObject());

    this.logger.info({ jobId: job.id, stepName: stepDef.name, stepIndex: index }, 'Step started');

    try {
      const result = await stepDef.handler(context);
      await this.stepMemoizer.setStepResult(job.id, index, result);
      const durationMs = Date.now() - startedAt.getTime();

      await this.jobPersistence.completeJobStep(stepRecord.id, this.toRecord(result), durationMs);

      this.logger.info({ jobId: job.id, stepName: stepDef.name, stepIndex: index, durationMs }, 'Step completed');
      return result;
    } catch (error) {
      const durationMs = Date.now() - startedAt.getTime();
      const wrapped = new StepExecutionError(job.id, stepDef.name, index, error);

      await this.jobPersistence.failJobStep(stepRecord.id, wrapped.message, durationMs);

      this.logger.error(
        { jobId: job.id, stepName: stepDef.name, stepIndex: index, durationMs, err: wrapped },
        'Step failed',
      );
      throw wrapped;
    }
  }

  private async completeJob(jobId: string, context: StepContext<TInput>): Promise<JobResult<TOutput>> {
    assertTransition('running', 'completed');
    const data = context.toObject() as TOutput;

    await this.jobPersistence.updateJobStatus(jobId, 'completed', {
      result_summary: context.toObject(),
      completed_at: new Date(),
    });

    const result: JobResult<TOutput> = { status: 'completed', data, error: null };
    await this.onJobComplete(jobId, result);
    return result;
  }

  private async failJob(jobId: string, error: StepExecutionError): Promise<JobResult<TOutput>> {
    assertTransition('running', 'failed');

    await this.jobPersistence.updateJobStatus(jobId, 'failed', {
      error_message: error.message,
      completed_at: new Date(),
    });

    const result: JobResult<TOutput> = { status: 'failed', data: null, error };
    await this.onJobFailed(jobId, error);
    return result;
  }

  private assertUniqueStepNames(steps: Array<AgentStep<TInput>>): void {
    const seen = new Set<string>();
    for (const step of steps) {
      if (seen.has(step.name)) {
        throw new DuplicateStepNameError(step.name);
      }
      seen.add(step.name);
    }
  }

  /** JobStep.output_data is a DB column typed `Record<string, unknown> | null` — a step's own result type (TResult) isn't necessarily an object, so non-object results are wrapped for persistence while StepContext still hands back the unwrapped, typed value to later steps. */
  private toRecord(value: unknown): Record<string, unknown> | null {
    if (value === undefined) {
      return null;
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return { value };
  }
}

export type { JobStatus };
