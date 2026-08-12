import type { AgentJob } from '../adapters/data/entities/AgentJob.js';
import type { JobStatus } from '../adapters/data/enums.js';
import type { JobStep } from '../adapters/data/entities/JobStep.js';
import type { IRepository } from '../adapters/data/interfaces/IRepository.js';
import type { FilterOptions, SortOptions } from '../adapters/data/types.js';

/**
 * Wraps `IRepository<AgentJob>`/`IRepository<JobStep>` with the specific
 * read/write operations BaseAgent's execute loop needs (WO-031) — never
 * a direct Prisma/Mongoose call, per this WO's own constraint. Contains
 * zero business logic beyond that wrapping (matching the codebase's
 * "repositories contain zero business logic" convention from
 * CLAUDE.md, extended here to this thin persistence-orchestration
 * layer): BaseAgent still owns all state-machine and memoization
 * decisions, this class only persists what BaseAgent tells it to.
 */
export class JobPersistence {
  public constructor(
    private readonly agentJobRepository: IRepository<AgentJob>,
    private readonly jobStepRepository: IRepository<JobStep>,
  ) {
    if (!agentJobRepository) {
      throw new Error('JobPersistence requires an agentJobRepository — received null/undefined.');
    }
    if (!jobStepRepository) {
      throw new Error('JobPersistence requires a jobStepRepository — received null/undefined.');
    }
  }

  public async createJob(data: Omit<AgentJob, 'id' | 'created_at' | 'updated_at'>): Promise<AgentJob> {
    return this.agentJobRepository.create(data);
  }

  public async getJob(jobId: string): Promise<AgentJob | null> {
    return this.agentJobRepository.findById(jobId);
  }

  public async updateJobStatus(
    jobId: string,
    status: JobStatus,
    extra: Partial<Omit<AgentJob, 'id' | 'created_at' | 'updated_at' | 'status'>> = {},
  ): Promise<AgentJob> {
    return this.agentJobRepository.update(jobId, { status, ...extra });
  }

  public async createJobStep(
    jobId: string,
    stepOrder: number,
    stepName: string,
    inputData: Record<string, unknown>,
  ): Promise<JobStep> {
    return this.jobStepRepository.create({
      job_id: jobId,
      step_order: stepOrder,
      step_name: stepName,
      status: 'running',
      input_data: inputData,
      output_data: null,
      error_message: null,
      duration_ms: null,
      started_at: new Date(),
      completed_at: null,
    });
  }

  public async completeJobStep(
    stepId: string,
    outputData: Record<string, unknown> | null,
    durationMs: number,
  ): Promise<JobStep> {
    return this.jobStepRepository.update(stepId, {
      status: 'completed',
      output_data: outputData,
      duration_ms: durationMs,
      completed_at: new Date(),
    });
  }

  public async failJobStep(stepId: string, errorMessage: string, durationMs: number): Promise<JobStep> {
    return this.jobStepRepository.update(stepId, {
      status: 'failed',
      error_message: errorMessage,
      duration_ms: durationMs,
      completed_at: new Date(),
    });
  }

  public async findJobSteps(jobId: string): Promise<JobStep[]> {
    const filters = { job_id: { operator: 'eq', value: jobId } } as FilterOptions<JobStep>;
    const sort = { step_order: 'asc' } as SortOptions<JobStep>;
    // No pagination object — omitting it (rather than a hardcoded limit)
    // returns every step for the job unpaginated, per IRepository's own
    // contract; a job realistically has single or low-double-digit steps.
    const result = await this.jobStepRepository.findMany(filters, sort);
    return result.items;
  }
}
