import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { FastifyPluginAsync } from 'fastify';

import { Role } from '../auth/roles.js';
import { jobEventBus } from '../events/job-events.js';
import { uuidParamsSchema } from '../schemas/index.js';

const KEEP_ALIVE_INTERVAL_MS = 15_000;

/**
 * Server-Sent Events for job progress (WO-045). One HTTP connection per
 * subscriber, held open with `reply.hijack()` — Fastify's own response
 * lifecycle (serialization, `onSend` hooks expecting a return value)
 * would otherwise fight with writing to `reply.raw` directly. Periodic
 * `:ping` comments keep intermediary proxies/load balancers from timing
 * out an idle-looking long-lived connection.
 */
export const eventRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/jobs/:id', { config: { requiredRole: Role.VIEWER }, schema: { params: uuidParamsSchema } }, async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const unsubscribe = jobEventBus.subscribe(request.params.id, (event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    const keepAlive = setInterval(() => reply.raw.write(':ping\n\n'), KEEP_ALIVE_INTERVAL_MS);
    keepAlive.unref();

    request.raw.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
      reply.raw.end();
    });
  });
};
