import type { Logger } from 'pino';

import type { AuditLog, IRepository } from '../adapters/data/index.js';
import type { AuditEntry, IAuditLogger } from './types/registry.types.js';

/**
 * Writes immutable audit records via `IRepository<AuditLog>` — no
 * direct Prisma/Mongoose imports, per every registry service's
 * constraint. Never updates or deletes an existing record.
 *
 * `log()` never rejects: a failed audit write is logged as a warning
 * and swallowed, per the WO's "fire-and-forget with error logging"
 * error-handling rule — an audit trail problem must never block the
 * primary registry mutation it's recording.
 */
export class AuditLogger implements IAuditLogger {
  public constructor(
    private readonly repository: IRepository<AuditLog>,
    private readonly logger: Logger,
  ) {}

  public async log(entry: AuditEntry): Promise<void> {
    try {
      await this.repository.create({
        actor_id: entry.actor_id,
        action: entry.action,
        resource_type: entry.resource_type,
        resource_id: entry.resource_id,
        change_details: entry.change_details,
        ip_address: entry.ip_address ?? null,
        user_agent: entry.user_agent ?? null,
      });
    } catch (error) {
      this.logger.warn({ err: error, entry }, 'Failed to write audit log entry');
    }
  }
}
