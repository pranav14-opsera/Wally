import type { AgentJob, AgentJobWithDriftEvents, AgentJobWithSteps } from '../entities/AgentJob.js';
import type { IRepository } from './IRepository.js';

/**
 * Extends the generic repository with composite queries that hide the
 * Postgres-join vs. Mongo-embedded-array difference behind a single
 * method each — see `AgentJobWithSteps`/`AgentJobWithDriftEvents` in
 * src/adapters/data/entities/AgentJob.ts for why these return types
 * exist rather than making callers join JobStep/DriftEvent themselves.
 */
export interface IAgentJobRepository extends IRepository<AgentJob> {
  findByIdWithSteps(id: string): Promise<AgentJobWithSteps | null>;
  findByIdWithDriftEvents(id: string): Promise<AgentJobWithDriftEvents | null>;
}
