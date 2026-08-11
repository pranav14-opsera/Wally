import type { Logger } from 'pino';

export interface RequestContext {
  requestId: string;
  actorId?: string;
  resource?: string;
  operation?: string;
}

/**
 * Returns a child logger with request-scoped context bound to every
 * subsequent log call. Child loggers inherit the parent's level, redact
 * config, and serializers — only the bound fields differ.
 */
export function createRequestLogger(logger: Logger, context: RequestContext): Logger {
  return logger.child({ ...context });
}
