import type { FastifyInstance } from 'fastify';

import { attachContainer } from '../container.js';
import {
  adminRoutes,
  agentRoutes,
  authRoutes,
  eventRoutes,
  healthRoutes,
  registryRoutes,
} from '../routes/index.js';
import type { GatewayContainer } from '../types.js';
import { authPlugin } from './auth.js';
import { corsPlugin } from './cors.js';
import { errorHandlerPlugin } from './error-handler.js';
import { requestIdPlugin } from './request-id.js';
import { rbacMiddleware } from '../auth/rbac.middleware.js';
import { securityHeadersPlugin } from './security-headers.js';
import { zodValidationPlugin } from './zod-validation.js';

const API_PREFIX = '/api/v1';

/**
 * Registers every gateway plugin in the order that matters:
 * 1. The DI container decorator — every plugin/route below reads `fastify.container`.
 * 2. CORS — must run before anything else touches the request (WO-037 AC1).
 * 3. Security headers — after CORS, before request-processing middleware (WO-038).
 * 4. Request ID — before the error handler, so every error path has `request.requestId`.
 * 5. The global error handler — before validation, so validation failures resolve through it.
 * 6. Zod request validation — before routes, so it applies to every route schema below.
 * 7. Domain route groups.
 */
export async function registerPlugins(app: FastifyInstance, container: GatewayContainer): Promise<void> {
  attachContainer(app, container);

  // Called as plain functions directly on the root `app` — NOT via
  // `app.register()`. Fastify's `.register()` creates a new encapsulation
  // context per call; hooks/decorators/compilers added inside one would
  // be invisible to the route-group plugins registered as siblings below.
  // Calling them directly (same as `attachContainer` above) attaches
  // everything straight onto the root instance, which every child scope
  // inherits. `@fastify/cors`/`@fastify/helmet` are themselves already
  // `fastify-plugin`-wrapped internally, so `corsPlugin`/
  // `securityHeadersPlugin` calling `app.register(cors/helmet, ...)`
  // from here still attaches globally, not just to a child context.
  await corsPlugin(app);
  await securityHeadersPlugin(app);
  await requestIdPlugin(app);
  await errorHandlerPlugin(app);
  await zodValidationPlugin(app);
  await authPlugin(app);
  await rbacMiddleware(app);

  await app.register(healthRoutes, { prefix: `${API_PREFIX}/health` });
  await app.register(authRoutes, { prefix: `${API_PREFIX}/auth` });
  await app.register(agentRoutes, { prefix: `${API_PREFIX}/agents` });
  await app.register(registryRoutes, { prefix: `${API_PREFIX}/registries` });
  await app.register(adminRoutes, { prefix: `${API_PREFIX}/admin` });
  await app.register(eventRoutes, { prefix: `${API_PREFIX}/events` });
}
