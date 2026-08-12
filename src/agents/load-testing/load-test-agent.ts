import type { Logger } from 'pino';

import type { IAgentJobRepository, IRepository, JobStep, LoadTestResult } from '../../adapters/data/index.js';
import type { JobEventBus } from '../../gateway/events/job-events.js';
import { BaseAgent } from '../base/base-agent.js';
import type { AgentStepDefinition } from '../base/types.js';
import { runK6 } from './k6-runner.js';
import type { LoadTestProfile } from './schemas.js';
import type { K6RunResult } from './k6-runner.js';

export interface LoadTestContext {
  profile: LoadTestProfile;
}

export interface LoadTestAgentDeps {
  jobId: string;
  agentJobs: IAgentJobRepository;
  jobSteps: IRepository<JobStep>;
  loadTestResults: IRepository<LoadTestResult>;
  logger: Logger;
  events: JobEventBus;
  k6BinaryPath: string;
  computeTimeoutMs: number;
  progressIntervalMs: number;
  stderrTailLength: number;
  minStepDurationMs: number;
}

const RUN_K6_STEP_ORDER = 1;

/** The Load Testing Agent's three-step pipeline (WO-093/094/095, trimmed): validate the profile, run k6, evaluate the result against the profile's SLO thresholds and persist it. */
export class LoadTestAgent extends BaseAgent<LoadTestContext> {
  protected readonly steps: ReadonlyArray<AgentStepDefinition<LoadTestContext>>;

  private k6Result: K6RunResult | undefined;

  public constructor(private readonly deps: LoadTestAgentDeps) {
    super(deps.jobId, deps.agentJobs, deps.jobSteps, deps.logger, deps.events, deps.minStepDurationMs);

    this.steps = [
      { name: 'validate_profile', run: (context) => this.validateProfile(context) },
      { name: 'run_k6', run: (context) => this.executeK6(context) },
      { name: 'evaluate_slo', run: (context) => this.evaluateSlo(context) },
    ];
  }

  private async validateProfile(context: LoadTestContext): Promise<void> {
    if (!context.profile.targetUrl) {
      throw new Error('targetUrl is required');
    }
  }

  private async executeK6(context: LoadTestContext): Promise<void> {
    this.k6Result = await runK6(
      context.profile,
      {
        k6BinaryPath: this.deps.k6BinaryPath,
        timeoutMs: this.deps.computeTimeoutMs,
        progressIntervalMs: this.deps.progressIntervalMs,
        stderrTailLength: this.deps.stderrTailLength,
      },
      this.deps.logger,
      (elapsedSeconds) => this.publishProgress('run_k6', RUN_K6_STEP_ORDER, elapsedSeconds),
    );
  }

  private async evaluateSlo(context: LoadTestContext): Promise<void> {
    if (!this.k6Result) {
      throw new Error('run_k6 step did not produce a result');
    }
    const { thresholds } = context.profile;
    const verdict =
      this.k6Result.p95LatencyMs <= thresholds.p95LatencyMs && this.k6Result.errorRatePct <= thresholds.errorRatePct
        ? ('pass' as const)
        : ('fail' as const);

    const record = await this.deps.loadTestResults.create({
      job_id: this.deps.jobId,
      profile_config: context.profile as unknown as Record<string, unknown>,
      p50_latency_ms: this.k6Result.p50LatencyMs,
      p95_latency_ms: this.k6Result.p95LatencyMs,
      p99_latency_ms: this.k6Result.p99LatencyMs,
      throughput_rps: this.k6Result.throughputRps,
      error_rate_pct: this.k6Result.errorRatePct,
      slo_verdict: verdict,
      raw_metrics: this.k6Result.rawMetrics,
      executed_at: new Date(),
    });

    this.publishCompletedResult(record);
  }
}
