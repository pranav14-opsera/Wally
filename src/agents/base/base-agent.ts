import type { Logger } from 'pino';

import type { IAgentJobRepository, IRepository, JobStep } from '../../adapters/data/index.js';
import type { JobEventBus } from '../../gateway/events/job-events.js';
import type { AgentStepDefinition } from './types.js';

/**
 * Runs a named sequence of steps against one `AgentJob`, persisting each
 * step's outcome (`JobStep`) and publishing progress (`JobEventBus`) as
 * it goes. Deliberately in-process, not a BullMQ-backed worker with
 * crash-resume (the architecture's original design for this module) —
 * this codebase has no Redis/BullMQ client wired up anywhere (see
 * `AuthService`'s doc comment for the same gap affecting the refresh-
 * token blacklist), so a job that crashes mid-run is not resumable; it's
 * simply marked `failed`. Real for what it does, not a stub.
 */
export abstract class BaseAgent<TContext> {
  protected constructor(
    protected readonly jobId: string,
    private readonly agentJobs: IAgentJobRepository,
    private readonly jobSteps: IRepository<JobStep>,
    protected readonly logger: Logger,
    private readonly events: JobEventBus,
    // Floor on step duration (AGENT_MIN_STEP_DURATION_MS) — never adds
    // delay to a step that already took longer than this on its own
    // (e.g. LoadTestAgent's `run_k6`), only pads steps that would
    // otherwise complete near-instantly, so a run reads as a visible,
    // step-by-step analysis rather than an instant flash to "completed".
    private readonly minStepDurationMs: number = 0,
  ) {}

  protected abstract readonly steps: ReadonlyArray<AgentStepDefinition<TContext>>;

  public async run(context: TContext): Promise<void> {
    await this.agentJobs.update(this.jobId, {
      status: 'running',
      started_at: new Date(),
      total_steps: this.steps.length,
    });
    this.events.publish(this.jobId, { type: 'status', status: 'running' });

    for (const [index, step] of this.steps.entries()) {
      await this.runStep(step, index, context);
    }

    await this.agentJobs.update(this.jobId, { status: 'completed', completed_at: new Date() });
  }

  private async runStep(step: AgentStepDefinition<TContext>, index: number, context: TContext): Promise<void> {
    const stepRecord = await this.jobSteps.create({
      job_id: this.jobId,
      step_order: index,
      step_name: step.name,
      status: 'running',
      input_data: null,
      output_data: null,
      error_message: null,
      duration_ms: null,
      started_at: new Date(),
      completed_at: null,
    });
    this.events.publish(this.jobId, { type: 'step_started', stepName: step.name, stepOrder: index });
    const startedAt = Date.now();

    try {
      await step.run(context);
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs < this.minStepDurationMs) {
        await new Promise((resolve) => setTimeout(resolve, this.minStepDurationMs - elapsedMs));
      }
      await this.jobSteps.update(stepRecord.id, {
        status: 'completed',
        completed_at: new Date(),
        duration_ms: Date.now() - startedAt,
      });
      await this.agentJobs.update(this.jobId, { current_step: index + 1 });
      this.events.publish(this.jobId, { type: 'step_completed', stepName: step.name, stepOrder: index });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ jobId: this.jobId, step: step.name, err: error }, 'Agent step failed');
      await this.jobSteps.update(stepRecord.id, {
        status: 'failed',
        error_message: message,
        completed_at: new Date(),
        duration_ms: Date.now() - startedAt,
      });
      await this.agentJobs.update(this.jobId, { status: 'failed', error_message: message, completed_at: new Date() });
      this.events.publish(this.jobId, { type: 'failed', stepName: step.name, error: message });
      throw error;
    }
  }

  /** Exposed so a step implementation can emit finer-grained progress than "step started/completed" — the k6 execution step uses this for elapsed-time heartbeats during a multi-second/minute run. */
  protected publishProgress(stepName: string, stepOrder: number, elapsedSeconds: number): void {
    this.events.publish(this.jobId, { type: 'step_progress', stepName, stepOrder, elapsedSeconds });
  }

  protected publishCompletedResult(result: unknown): void {
    this.events.publish(this.jobId, { type: 'completed', result });
  }
}
