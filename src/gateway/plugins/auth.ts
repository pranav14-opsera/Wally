import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { ACCESS_TOKEN_COOKIE, CSRF_COOKIE } from '../auth/cookie.service.js';
import { JwtService } from '../auth/jwt.service.js';
import { Role } from '../auth/roles.js';
import { AppError } from '../utils/errors.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function extractBearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
}

/**
 * Loads the JWT signing key pair and registers the access-token
 * preHandler (WO-040). `Role.PUBLIC` routes (login, refresh, logout,
 * health) skip this entirely — refresh/logout verify their OWN
 * refresh-token cookie directly in `AuthService`, since by definition a
 * client calling `/auth/refresh` may have an *expired* access token.
 *
 * Token precedence: `Authorization: Bearer` wins over the cookie when
 * both are present (WO-040 edge case) — CLI/CI callers that explicitly
 * set a Bearer header get Bearer semantics (including a CSRF bypass),
 * never accidentally cookie semantics.
 */
export async function authPlugin(app: FastifyInstance): Promise<void> {
  await app.register(fastifyCookie);

  const jwtService = new JwtService(app.container.cloudSecrets);
  await jwtService.init();
  app.decorate('jwt', jwtService);

  app.addHook('preHandler', async (request) => {
    // Global preHandler hooks also run for unmatched routes (Fastify
    // routes 404s through the normal request lifecycle) — let those fall
    // through to `setNotFoundHandler` untouched instead of returning 401
    // for a route that was never going to exist regardless of auth.
    if (request.is404 || request.routeOptions.config.requiredRole === Role.PUBLIC) {
      return;
    }

    const bearerToken = extractBearerToken(request);
    const isBearerAuth = bearerToken !== undefined;
    const token = bearerToken ?? request.cookies[ACCESS_TOKEN_COOKIE];

    if (!token) {
      throw new AppError('Authentication required', 'AUTHENTICATION_ERROR', 401);
    }

    request.user = jwtService.verifyToken(token, 'access');

    // CSRF only applies to cookie-based auth on state-changing requests
    // (WO-040 AC5/constraint) — Bearer callers are non-browser clients
    // with nothing for a cross-site form to forge.
    if (!isBearerAuth && MUTATING_METHODS.has(request.method)) {
      const csrfCookie = request.cookies[CSRF_COOKIE];
      const csrfHeader = request.headers['x-csrf-token'];
      if (!csrfCookie || csrfCookie !== csrfHeader) {
        throw new AppError('CSRF token missing or invalid', 'CSRF_VALIDATION_FAILED', 403);
      }
    }
  });
}
