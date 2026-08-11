import type { Logger } from 'pino';

import type {
  AccessControlAuditEvent,
  AuthAuditEvent,
  IAuditLogger,
  MutationAuditEvent,
} from './audit-logger.js';

/**
 * Writes audit events to the application's Pino logger at `info` level
 * with an `audit: true` flag for filtering/routing. This is the local
 * development implementation of `IAuditLogger` — a DB-backed
 * implementation persisting to an append-only table lands in a later
 * epic behind the same interface.
 *
 * Audit events are compliance-critical: a write failure is logged at
 * `error` level and then re-thrown rather than swallowed, so callers
 * cannot silently lose an audit record.
 */
export class ConsoleAuditLogger implements IAuditLogger {
  public constructor(private readonly logger: Logger) {}

  public logAuthEvent(event: AuthAuditEvent): void {
    this.writeAuditEvent('auth', event);
  }

  public logMutationEvent(event: MutationAuditEvent): void {
    this.writeAuditEvent('mutation', event);
  }

  public logAccessControlEvent(event: AccessControlAuditEvent): void {
    this.writeAuditEvent('access_control', event);
  }

  private writeAuditEvent(
    eventType: 'auth' | 'mutation' | 'access_control',
    event: AuthAuditEvent | MutationAuditEvent | AccessControlAuditEvent,
  ): void {
    try {
      this.logger.info({ audit: true, eventType, ...event }, `Audit event: ${eventType}`);
    } catch (error) {
      this.logger.error(
        { audit: true, eventType, err: error },
        `Failed to write audit event: ${eventType}`,
      );
      throw error;
    }
  }
}
