import type { FastifyPluginAsync } from 'fastify';

import { Role } from '../auth/roles.js';
import { HealthService } from '../services/health.service.js';

const PUBLIC = { config: { requiredRole: Role.PUBLIC } };

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  const healthService = new HealthService(fastify.container.dataAdapter, fastify.container.config.HEALTH_CHECK_TIMEOUT_MS);

  fastify.get('/live', PUBLIC, async () => ({ status: 'alive', timestamp: new Date().toISOString() }));

  fastify.get('/ready', PUBLIC, async (_request, reply) => {
    const health = await healthService.checkAll();
    reply.status(health.status === 'healthy' ? 200 : 503).send(health);
  });

  fastify.get('/', PUBLIC, async (_request, reply) => {
    const health = await healthService.checkAll();
    reply.status(health.status === 'healthy' ? 200 : 503).send(health);
  });
};
