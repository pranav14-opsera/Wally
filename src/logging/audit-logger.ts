export interface AuthAuditEvent {
  actor: string;
  action: string;
  ip: string;
  userAgent: string;
  timestamp: string;
  success: boolean;
}

export interface MutationAuditEvent {
  actor: string;
  resource: string;
  operation: string;
  changeDetails: Record<string, unknown>;
  timestamp: string;
}

export interface AccessControlAuditEvent {
  actor: string;
  resource: string;
  requiredRole: string;
  actualRole: string;
  timestamp: string;
  allowed: boolean;
}

/**
 * Contract for immutable audit records. Audit events are compliance-critical
 * (1-year minimum retention per the Data Flow Audit Logging policy) —
 * implementations must never silently swallow a write failure.
 * `ConsoleAuditLogger` is the local-development implementation; a
 * DB-backed implementation persisting to an append-only table lands in a
 * later epic without changing this interface.
 */
export interface IAuditLogger {
  logAuthEvent(event: AuthAuditEvent): void;
  logMutationEvent(event: MutationAuditEvent): void;
  logAccessControlEvent(event: AccessControlAuditEvent): void;
}
