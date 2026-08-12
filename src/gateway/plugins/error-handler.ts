import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import { AppError } from '../utils/errors.js';
import { error as errorEnvelope } from '../utils/response.js';
import type { ErrorDetail } from '../types.js';

/** `/config/limits/maxVUs` (JSON-pointer style, as `fastify-type-provider-zod` reports it) -> `config.limits.maxVUs` (dot notation, per this WO's edge-case requirement). */
function instancePathToField(instancePath: string): string {
  return instancePath.replace(/^\//, '').replaceAll('/', '.');
}

function zodErrorToDetails(zodError: ZodError): ErrorDetail[] {
  return zodError.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
}

/**
 * Global error handler (WO-039) — the single place every thrown error in
 * the gateway resolves to a response. Order of checks matters: `AppError`
 * first (routes' own intentional errors), then the two validation-error
 * shapes Zod can reach this handler in (`fastify-type-provider-zod`'s
 * schema-validation failures carry a `.validation` array rather than
 * throwing a `ZodError` directly; code that calls `schema.parse()`
 * manually outside the type-provider throws a real `ZodError`), then an
 * unknown-error fallback that never leaks the original message or stack
 * to the client.
 */
export async function errorHandlerPlugin(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((err, request, reply) => {
    const requestId = request.requestId;

    if (err instanceof AppError) {
      request.log.warn({ err, requestId }, 'Request failed with a known application error');
      reply.status(err.statusCode).send(errorEnvelope(err.code, err.message, requestId, err.details));
      return;
    }

    if (hasZodFastifySchemaValidationErrors(err)) {
      const details = err.validation.map((issue) => ({
        field: instancePathToField(issue.instancePath),
        message: issue.message,
      }));
      request.log.warn({ err, requestId }, 'Request failed schema validation');
      reply.status(400).send(errorEnvelope('VALIDATION_ERROR', 'Request validation failed', requestId, details));
      return;
    }

    if (err instanceof ZodError) {
      request.log.warn({ err, requestId }, 'Request failed validation');
      reply
        .status(400)
        .send(errorEnvelope('VALIDATION_ERROR', 'Request validation failed', requestId, zodErrorToDetails(err)));
      return;
    }

    // Fastify normalizes thrown non-Error values (string, number, etc.)
    // into the object it hands this handler, but doesn't guarantee it's
    // an `Error` instance — never call `.message`/`.statusCode` on it
    // without checking first (this WO's "non-Error objects thrown" edge case).
    const normalized = err instanceof Error ? err : new Error(String(err));
    const statusCode =
      'statusCode' in normalized && typeof normalized.statusCode === 'number' ? normalized.statusCode : 500;

    request.log.error({ err: normalized, requestId, url: request.url }, 'Unhandled request error');
    reply
      .status(statusCode)
      .send(
        errorEnvelope(
          statusCode >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR',
          statusCode >= 500 ? 'Internal server error' : normalized.message,
          requestId,
        ),
      );
  });
}
