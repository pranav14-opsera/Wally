import type {
  AccessControlAuditEvent,
  AuthAuditEvent,
  MutationAuditEvent,
} from '../../src/logging/audit-logger.js';

/**
 * A payload containing PII fields (email, password, token) for exercising
 * redaction. See tests/fixtures/README.md for fixture conventions.
 */
export function createSampleLogPayload(overrides: Record<string, unknown> = {}): {
  email: string;
  password: string;
  token: string;
  message: string;
} {
  return {
    email: 'jane.doe@example.com',
    password: 'super-secret-password',
    token: 'ey.jwt.token',
    message: 'user logged in',
    ...overrides,
  };
}

export function createAuthAuditEvent(overrides: Partial<AuthAuditEvent> = {}): AuthAuditEvent {
  return {
    actor: 'user-123',
    action: 'login',
    ip: '203.0.113.5',
    userAgent: 'vitest/1.0',
    timestamp: '2026-08-11T12:00:00.000Z',
    success: true,
    ...overrides,
  };
}

export function createMutationAuditEvent(
  overrides: Partial<MutationAuditEvent> = {},
): MutationAuditEvent {
  return {
    actor: 'user-123',
    resource: 'tool-registry-entry:abc',
    operation: 'update',
    changeDetails: { field: 'status', from: 'draft', to: 'published' },
    timestamp: '2026-08-11T12:00:00.000Z',
    ...overrides,
  };
}

export function createAccessControlAuditEvent(
  overrides: Partial<AccessControlAuditEvent> = {},
): AccessControlAuditEvent {
  return {
    actor: 'user-123',
    resource: 'tool-registry',
    requiredRole: 'admin',
    actualRole: 'viewer',
    timestamp: '2026-08-11T12:00:00.000Z',
    allowed: false,
    ...overrides,
  };
}
