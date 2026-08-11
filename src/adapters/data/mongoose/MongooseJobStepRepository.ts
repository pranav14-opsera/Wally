import type { Model } from 'mongoose';
import type { Logger } from 'pino';

import type { JobStep } from '../entities/JobStep.js';
import { mapEmbeddedJobStep } from './mappers.js';
import { MongooseEmbeddedArrayRepository } from './MongooseEmbeddedArrayRepository.js';
import { MAX_JOB_STEPS } from './schemas/AgentJob.schema.js';

/** Operates on the `job_steps` embedded array of AgentJob documents — see MongooseEmbeddedArrayRepository for the shared mechanics. */
export class MongooseJobStepRepository extends MongooseEmbeddedArrayRepository<JobStep> {
  public constructor(agentJobModel: Model<Record<string, unknown>>, logger: Logger) {
    super(agentJobModel, 'job_steps', 'JobStep', logger, mapEmbeddedJobStep, MAX_JOB_STEPS);
  }
}
