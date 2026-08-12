import type { Logger } from 'pino';

import type { AgentJob } from '../adapters/data/entities/AgentJob.js';
import type { JobStep } from '../adapters/data/entities/JobStep.js';
import type { IRepository } from '../adapters/data/interfaces/IRepository.js';
import type { IRedisClient } from '../adapters/redis/interfaces/IRedisClient.js';
import { DuplicateStepNameError, StepExecutionError } from './errors.js';
import { assertTransition } from './state-machine.js';
import { StepContext } from './step-context.js';
import type { AgentJobConfig, AgentStep, JobResult, JobStatus } from './types.js';

/**
 * Foundational execution framework every Wally agent (Integration,
 * Validation, Load Testing, API Lifecycle) extends. Depends only on
 * adapter interfaces (`IRepository`, `Redis`, `Logger`) and BullMQ-adjacent
 * types — never a concrete adapter, the gateway, or a registry
 * implementation (dependency inversion, per this WO's own constraint).
 *
 * `redis` is accepted and validated here but not yet used by any method —
 * step memoization / crash-resume (WO-031) and SSE progress publishing
 * (WO-033) are the consumers; the injection point exists now so neither
 * of those WOs needs a breaking constructor change.
 */
export abstract class BaseAgent<TInput extends Record<string, unknown> = Record<string, unknown>, TOutput = unknown> {
  protected constructor(
    protected readonly agentJobRepository: IRepository<AgentJob>,
    protected readonly jobStepRepository: IRepository<JobStep>,
    protected readonly redis: IRedisClient,
    protected readonly logger: Logger,
    protected readonly config: AgentJobConfig,
  ) {
    if (!agentJobRepository) {
      throw new Error('BaseAgent requires an agentJobRepository — received null/undefined.');
    }
    if (!jobStepRepository) {
      throw new Error('BaseAgent requires a jobStepRepository — received null/undefined.');
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

  /** Invoked after each step resolves successfully. Default is a no-op; override to observe progress (e.g. publish an SSE event in a later WO). */
  protected onStepComplete(_stepName: string, _result: unknown, _context: StepContext<TInput>): void | Promise<void> {
    // Intentionally empty — override point for subclasses.
  }

  /** Invoked once, after every step has completed successfully. */
  protected onJobComplete(_jobId: string, _result: JobResult<TOutput>): void | Promise<void> {
    // Intentionally empty — override point for subclasses.
  }

  /** Invoked once, when a step throws (sync or async) or the job cannot start. */
  protected onJobFailed(_jobId: string, _error: Error): void | Promise<void> {
    // Intentionally empty — override point for subclasses.
  }

  /**
   * Runs every step of `defineSteps()` in order against `input`, persisting
   * job/step state through the injected repositories as it goes. Resolves
   * (never rejects) with a `status: 'failed'` result when a step handler
   * throws — that is an expected, data-carrying outcome, not a programming
   * error. It DOES throw for usage errors: an unknown `jobId`, an
   * already-terminal job, or a `defineSteps()` that returns duplicate
   * names — none of those are things a caller should have to unwrap from
   * a resolved result.
   */
  public async execute(jobId: string, input: TInput): Promise<JobResult<TOutput>> {
    const job = await this.agentJobRepository.findById(jobId);
    if (!job) {
      throw new Error(`BaseAgent.execute: no AgentJob found with id "${jobId}".`);
    }

    assertTransition(job.status, 'running');
    await this.agentJobRepository.update(jobId, { status: 'running', started_at: new Date() });

    const steps = this.defineSteps();
    this.assertUniqueStepNames(steps);

    if (steps.length === 0) {
      this.logger.warn({ jobId, agentType: this.config.agentType }, 'defineSteps() returned no steps — completing job immediately with an empty result.');
      return this.completeJob(jobId, new StepContext<TInput>(input));
    }

    const context = new StepContext<TInput>(input);

    for (const [index, stepDef] of steps.entries()) {
      try {
        const result = await this.step(job, stepDef, index, context);
        context.set(stepDef.name, result);
        await this.onStepComplete(stepDef.name, result, context);
      } catch (error) {
        const wrapped =
          error instanceof StepExecutionError ? error : new StepExecutionError(jobId, stepDef.name, index, error);
        return this.failJob(jobId, wrapped);
      }
    }

    return this.completeJob(jobId, context);
  }

  /** Persists a JobStep record for `stepDef`, runs its handler, and persists the outcome. Throws `StepExecutionError` on failure — callers (only `execute()`) decide how to translate that into job-level state. */
  protected async step<TResult>(
    job: AgentJob,
    stepDef: AgentStep<TInput, TResult>,
    index: number,
    context: StepContext<TInput>,
  ): Promise<TResult> {
    const startedAt = new Date();
    const stepRecord = await this.jobStepRepository.create({
      job_id: job.id,
      step_order: index,
      step_name: stepDef.name,
      status: 'running',
      input_data: context.toObject(),
      output_data: null,
      error_message: null,
      duration_ms: null,
      started_at: startedAt,
      completed_at: null,
    });

    this.logger.info({ jobId: job.id, stepName: stepDef.name, stepIndex: index }, 'Step started');

    try {
      const result = await stepDef.handler(context);
      const durationMs = Date.now() - startedAt.getTime();

      await this.jobStepRepository.update(stepRecord.id, {
        status: 'completed',
        output_data: this.toRecord(result),
        duration_ms: durationMs,
        completed_at: new Date(),
      });

      this.logger.info({ jobId: job.id, stepName: stepDef.name, stepIndex: index, durationMs }, 'Step completed');
      return result;
    } catch (error) {
      const durationMs = Date.now() - startedAt.getTime();
      const wrapped = new StepExecutionError(job.id, stepDef.name, index, error);

      await this.jobStepRepository.update(stepRecord.id, {
        status: 'failed',
        error_message: wrapped.message,
        duration_ms: durationMs,
        completed_at: new Date(),
      });

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

    await this.agentJobRepository.update(jobId, {
      status: 'completed',
      result_summary: context.toObject(),
      completed_at: new Date(),
    });

    const result: JobResult<TOutput> = { status: 'completed', data, error: null };
    await this.onJobComplete(jobId, result);
    return result;
  }

  private async failJob(jobId: string, error: StepExecutionError): Promise<JobResult<TOutput>> {
    assertTransition('running', 'failed');

    await this.agentJobRepository.update(jobId, {
      status: 'failed',
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
