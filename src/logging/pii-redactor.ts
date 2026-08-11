import type { LoggerOptions } from 'pino';

/**
 * Default PII field paths redacted from all log output, per the
 * organization's Data Flow Audit Logging policy: no email, password,
 * token, IP address, or credential may appear in plaintext in logs.
 *
 * Kept as a plain string array (not hardcoded inline in the logger
 * factory) so additional paths can be added without touching logger.ts.
 * Wildcard paths (`*.password`) catch the field at any nesting depth one
 * level down; deeper/array paths need their own explicit entry — see the
 * edge case notes in WO-004.
 */
export const DEFAULT_PII_PATHS: readonly string[] = [
  'email',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'creditCard',
  'ssn',
  'secret',
  'apiKey',
  'ip',
  '*.email',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.apiKey',
  '*.ip',
  'headers.authorization',
  'headers.Authorization',
  'headers.cookie',
  'headers.Cookie',
];

const REDACTION_CENSOR = '[REDACTED]';

/**
 * Builds a Pino `redact` configuration from a list of field paths. Pino
 * matches path segments case-sensitively, so callers targeting
 * case-insensitive header names (e.g. `authorization` vs `Authorization`)
 * must include both casings explicitly — `DEFAULT_PII_PATHS` already does
 * this for the `headers.*` paths.
 */
export function buildRedactConfig(paths: readonly string[]): LoggerOptions['redact'] {
  return {
    paths: [...paths],
    censor: REDACTION_CENSOR,
  };
}
