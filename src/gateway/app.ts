import Fastify from 'fastify';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';

import { registerPlugins } from './plugins/index.js';
import type { GatewayContainer } from './types.js';
import { error as errorEnvelope } from './utils/response.js';

/**
 * Builds a fully configured Fastify instance: Pino logging (reusing the
 * already-redacted logger from `container.logger`, WO-004), the DI
 * container decoration, and every domain route group under `/api/v1`.
 * Never calls `.listen()` — `server.ts` does that for production; tests
 * use Fastify's `.inject()` directly against the instance this returns
 * (Supertest-over-inject, no real socket needed).
 */
export async function buildApp(container: GatewayContainer): Promise<FastifyInstance> {
  const app = Fastify({
    // Pino's own `Logger` type carries a `msgPrefix` field Fastify's
    // narrower `FastifyBaseLogger` interface doesn't declare — reusing an
    // already-constructed pino instance here (rather than letting Fastify
    // build its own from options) is still fully log-interface-compatible
    // at runtime; only the two packages' independently-authored type
    // declarations disagree.
    loggerInstance: container.logger as unknown as FastifyBaseLogger,
    genReqId: () => crypto.randomUUID(),
  });

  // The global error handler (unhandled/thrown errors) is registered by
  // `errorHandlerPlugin` inside `registerPlugins` below, once
  // `request.requestId` exists to put in the envelope — 404s take a
  // separate Fastify hook (`setNotFoundHandler`, not `setErrorHandler`)
  // so it's set here instead, using the same envelope shape for consistency.
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(errorEnvelope('NOT_FOUND', `Route ${request.method} ${request.url} not found`, request.requestId));
  });

  await registerPlugins(app, container);

  return app;
}
