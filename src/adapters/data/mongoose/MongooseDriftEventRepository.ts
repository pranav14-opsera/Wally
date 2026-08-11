import type { Model } from 'mongoose';
import type { Logger } from 'pino';

import type { DriftEvent } from '../entities/DriftEvent.js';
import { mapEmbeddedDriftEvent } from './mappers.js';
import { MongooseEmbeddedArrayRepository } from './MongooseEmbeddedArrayRepository.js';
import { MAX_DRIFT_EVENTS } from './schemas/AgentJob.schema.js';

/** Operates on the `drift_events` embedded array of AgentJob documents — see MongooseEmbeddedArrayRepository for the shared mechanics. */
export class MongooseDriftEventRepository extends MongooseEmbeddedArrayRepository<DriftEvent> {
  public constructor(agentJobModel: Model<Record<string, unknown>>, logger: Logger) {
    super(agentJobModel, 'drift_events', 'DriftEvent', logger, mapEmbeddedDriftEvent, MAX_DRIFT_EVENTS);
  }
}
