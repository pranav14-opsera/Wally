import type { Logger } from 'pino';

import { BaseAgent } from '../../src/agents/base-agent.js';
import type { AgentStep } from '../../src/agents/types.js';
import type { AgentJob } from '../../src/adapters/data/entities/AgentJob.js';
import type { JobStep } from '../../src/adapters/data/entities/JobStep.js';
import type { IRepository } from '../../src/adapters/data/interfaces/IRepository.js';
import type { IRedisClient } from '../../src/adapters/redis/interfaces/IRedisClient.js';
import type { AgentJobConfig } from '../../src/agents/types.js';

export interface TestAgentInput extends Record<string, unknown> {
  seed: number;
}

/** Deterministic 5-step pipeline used across base-agent tests (WO-029) — each step reads `input.seed` and/or a prior step's result and appends one key to the context. */
export function buildDeterministicSteps(): Array<AgentStep<TestAgentInput>> {
  return [
    { name: 'step-a', handler: (ctx) => ctx.input.seed + 1 },
    { name: 'step-b', handler: (ctx) => ctx.get<number>('step-a') * 2 },
    { name: 'step-c', handler: (ctx) => ({ total: ctx.get<number>('step-b') }) },
    { name: 'step-d', handler: async (ctx) => `total-was-${ctx.get<{ total: number }>('step-c').total}` },
    { name: 'step-e', handler: () => undefined },
  ];
}

export class TestAgent extends BaseAgent<TestAgentInput, Record<string, unknown>> {
  public readonly stepCompleteCalls: Array<{ stepName: string; result: unknown }> = [];
  public jobCompleteResult: unknown;
  public jobFailedError: Error | undefined;

  private readonly steps: Array<AgentStep<TestAgentInput>>;

  public constructor(
    agentJobRepository: IRepository<AgentJob>,
    jobStepRepository: IRepository<JobStep>,
    redis: IRedisClient,
    logger: Logger,
    config: AgentJobConfig,
    steps: Array<AgentStep<TestAgentInput>> = buildDeterministicSteps(),
  ) {
    super(agentJobRepository, jobStepRepository, redis, logger, config);
    this.steps = steps;
  }

  protected defineSteps(): Array<AgentStep<TestAgentInput>> {
    return this.steps;
  }

  protected override onStepComplete(stepName: string, result: unknown): void {
    this.stepCompleteCalls.push({ stepName, result });
  }

  protected override onJobComplete(_jobId: string, result: { data: unknown }): void {
    this.jobCompleteResult = result.data;
  }

  protected override onJobFailed(_jobId: string, error: Error): void {
    this.jobFailedError = error;
  }
}

/** A step whose handler always throws — for exercising execute()'s failure path. */
export function buildFailingStep(name = 'failing-step'): AgentStep<TestAgentInput> {
  return {
    name,
    handler: () => {
      throw new Error(`${name} intentionally failed`);
    },
  };
}

/** A step whose handler returns a rejected promise — proves async rejections are caught identically to sync throws. */
export function buildAsyncFailingStep(name = 'async-failing-step'): AgentStep<TestAgentInput> {
  return {
    name,
    handler: async () => {
      throw new Error(`${name} intentionally rejected`);
    },
  };
}
