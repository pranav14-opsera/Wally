import type { FastifyInstance } from 'fastify';

import { AppError } from '../utils/errors.js';
import { hasPermission, Role } from './roles.js';
import './rbac.types.js';

/**
 * Runs after `authPlugin`'s preHandler (registration order in
 * plugins/index.ts), so `request.user` is already populated for any
 * route that isn't `Role.PUBLIC`. Deny-by-default (WO-041 AC5): a route
 * with no `config.requiredRole` at all is rejected, not silently allowed
 * — an omission must never be the same as intentionally public.
 */
export async function rbacMiddleware(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request) => {
    // Same "let 404s fall through" rationale as authPlugin's preHandler.
    if (request.is404) {
      return;
    }

    const requiredRole = request.routeOptions.config.requiredRole;

    if (requiredRole === undefined) {
      request.log.warn(
        { url: request.url, requestId: request.requestId },
        'RBAC: route has no requiredRole configured — denying by default',
      );
      throw new AppError('Route access not configured', 'AUTHORIZATION_ERROR', 403);
    }

    if (requiredRole === Role.PUBLIC) {
      return;
    }

    if (!request.user) {
      // Reachable if a route sets a real requiredRole but authPlugin's
      // hook didn't run first — a wiring bug, not a permissions failure,
      // so this is "not authenticated" (401), never "insufficient role" (403).
      throw new AppError('Authentication required', 'AUTHENTICATION_ERROR', 401);
    }

    if (!hasPermission(request.user.role, requiredRole)) {
      request.log.warn(
        {
          actorId: request.user.sub,
          requiredRole,
          actualRole: request.user.role,
          url: request.url,
          requestId: request.requestId,
        },
        'RBAC: insufficient role',
      );
      throw new AppError(`Requires ${requiredRole} role or higher`, 'AUTHORIZATION_ERROR', 403);
    }
  });
}
