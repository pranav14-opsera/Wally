import type { FastifyInstance } from 'fastify';

/**
 * Decorates every request with a server-generated UUID v4 (never a
 * client-supplied `X-Request-ID`, which wouldn't be guaranteed to be a
 * valid UUID) and echoes it back on the response for client-side log
 * correlation. Registered before the error handler so every error path —
 * including 404s and validation failures — has `request.requestId`
 * available.
 */
export async function requestIdPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request) => {
    request.requestId = crypto.randomUUID();
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Request-ID', request.requestId);
    return payload;
  });
}
