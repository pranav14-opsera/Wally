import type { Model } from 'mongoose';
import type { Logger } from 'pino';

import type { AgentJob, AgentJobWithDriftEvents, AgentJobWithSteps } from '../entities/AgentJob.js';
import type { IAgentJobRepository } from '../interfaces/IAgentJobRepository.js';
import { mapMongooseError } from './error-mapper.js';
import { mapEmbeddedDriftEvent, mapEmbeddedJobStep, toDomainEntity } from './mappers.js';
import { MongooseRepository } from './MongooseRepository.js';

/**
 * Adds AgentJob's two composite reads on top of the generic CRUD
 * `MongooseRepository` provides. Since `job_steps`/`drift_events` are
 * embedded arrays on the AgentJob document itself (WO-010), both reads
 * are a single `findById` — no join, no include — with the array
 * elements mapped through `mapEmbeddedJobStep`/`mapEmbeddedDriftEvent`
 * to inject the `job_id` those elements don't store themselves.
 */
export class MongooseAgentJobRepository extends MongooseRepository<AgentJob> implements IAgentJobRepository {
  public constructor(model: Model<Record<string, unknown>>, logger: Logger) {
    super(model, 'AgentJob', logger);
  }

  public async findByIdWithSteps(id: string): Promise<AgentJobWithSteps | null> {
    try {
      const doc = await this.model.findById(id).session(this.currentSession ?? null).lean();
      if (!doc) {
        return null;
      }

      const agentJob = toDomainEntity<AgentJob>(doc as Record<string, unknown>);
      const rawSteps = ((doc as Record<string, unknown>).job_steps ?? []) as Array<Record<string, unknown>>;
      const jobSteps = [...rawSteps]
        .sort((a, b) => (a.step_order as number) - (b.step_order as number))
        .map((step) => mapEmbeddedJobStep(step, id));

      return { ...agentJob, job_steps: jobSteps };
    } catch (error) {
      throw mapMongooseError(error, { entityName: 'AgentJob', operation: 'findByIdWithSteps' });
    }
  }

  public async findByIdWithDriftEvents(id: string): Promise<AgentJobWithDriftEvents | null> {
    try {
      const doc = await this.model.findById(id).session(this.currentSession ?? null).lean();
      if (!doc) {
        return null;
      }

      const agentJob = toDomainEntity<AgentJob>(doc as Record<string, unknown>);
      const rawDriftEvents = ((doc as Record<string, unknown>).drift_events ?? []) as Array<Record<string, unknown>>;
      const driftEvents = rawDriftEvents.map((event) => mapEmbeddedDriftEvent(event, id));

      return { ...agentJob, drift_events: driftEvents };
    } catch (error) {
      throw mapMongooseError(error, { entityName: 'AgentJob', operation: 'findByIdWithDriftEvents' });
    }
  }
}
