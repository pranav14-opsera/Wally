import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

/**
 * Builds a bare Fastify instance for use with Supertest's `.inject`-style
 * HTTP assertions in tests. Register routes/plugins on the returned
 * instance before calling `.ready()` and passing `app.server` to
 * `supertest()`.
 *
 * TODO(WO-035+): once the real Fastify application (plugin architecture,
 * routes, middleware) exists, register it here instead of a bare instance.
 */
export async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Placeholder for future middleware/plugin registration (CORS, auth,
  // request validation, etc.) as those modules land in later work orders.

  await app.ready();
  return app;
}
