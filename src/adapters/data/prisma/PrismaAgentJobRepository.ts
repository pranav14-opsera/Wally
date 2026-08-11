import type { Logger } from 'pino';

import type { AgentJob, AgentJobWithDriftEvents, AgentJobWithSteps } from '../entities/AgentJob.js';
import type { IAgentJobRepository } from '../interfaces/IAgentJobRepository.js';
import { mapPrismaError } from './error-mapper.js';
import { toDomainEntity } from './mappers.js';
import type { PrismaModelDelegate } from './PrismaRepository.js';
import { PrismaRepository } from './PrismaRepository.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';

/**
 * Adds AgentJob's two composite reads (`findByIdWithSteps`,
 * `findByIdWithDriftEvents`) on top of the generic CRUD `PrismaRepository`
 * provides. These use `include`, which the base class's narrow
 * `PrismaModelDelegate` structural type deliberately can't express — so
 * they're issued directly against `this.currentClient.agentJob` (the
 * base class's protected transaction-aware client accessor) rather than
 * through `this.delegate`, keeping them correctly transaction-scoped when
 * called from within `this.transaction(fn)` without duplicating that
 * scoping logic here.
 */
export class PrismaAgentJobRepository extends PrismaRepository<AgentJob> implements IAgentJobRepository {
  public constructor(prisma: PrismaClient, logger: Logger) {
    super(
      prisma,
      // Every model delegate has this shape at runtime (see
      // PrismaModelDelegate's doc comment in PrismaRepository.ts) — the
      // cast bridges from Prisma's fully-typed AgentJobDelegate to it.
      (client) => client.agentJob as unknown as PrismaModelDelegate<AgentJob>,
      'AgentJob',
      logger,
    );
  }

  public async findByIdWithSteps(id: string): Promise<AgentJobWithSteps | null> {
    try {
      const record = await this.currentClient.agentJob.findUnique({
        where: { id },
        include: { job_steps: { orderBy: { step_order: 'asc' } } },
      });
      return record ? toDomainEntity<AgentJobWithSteps>(record) : null;
    } catch (error) {
      throw mapPrismaError(error, { entityName: this.entityName, operation: 'findByIdWithSteps', id });
    }
  }

  public async findByIdWithDriftEvents(id: string): Promise<AgentJobWithDriftEvents | null> {
    try {
      const record = await this.currentClient.agentJob.findUnique({
        where: { id },
        include: { drift_events: true },
      });
      return record ? toDomainEntity<AgentJobWithDriftEvents>(record) : null;
    } catch (error) {
      throw mapPrismaError(error, { entityName: this.entityName, operation: 'findByIdWithDriftEvents', id });
    }
  }
}
