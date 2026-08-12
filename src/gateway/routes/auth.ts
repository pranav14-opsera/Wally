import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { FastifyPluginAsync } from 'fastify';

import { AuthService } from '../auth/auth.service.js';
import { REFRESH_TOKEN_COOKIE, clearTokenCookies, generateCsrfToken, setCsrfCookie, setTokenCookies } from '../auth/cookie.service.js';
import { Role } from '../auth/roles.js';
import { createLoginRequestSchema } from '../schemas/auth.schemas.js';
import { AppError } from '../utils/errors.js';
import { success } from '../utils/response.js';

function requestContext(request: { ip: string; headers: { 'user-agent'?: string } }): { ip: string; userAgent: string } {
  return { ip: request.ip, userAgent: request.headers['user-agent'] ?? 'unknown' };
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  const { container } = app;
  const authService = new AuthService(container.dataAdapter.repositories.users, app.jwt, container.logger);
  const isProduction = container.config.NODE_ENV === 'production';
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const loginRequestSchema = createLoginRequestSchema(container.config);

  typed.post(
    '/login',
    { config: { requiredRole: Role.PUBLIC }, schema: { body: loginRequestSchema } },
    async (request, reply) => {
      const { username, password } = request.body;
      const result = await authService.login(username, password, requestContext(request));

      setTokenCookies(reply, result.tokens, isProduction);
      const csrfToken = generateCsrfToken();
      setCsrfCookie(reply, csrfToken, isProduction);
      reply.header('X-CSRF-Token', csrfToken);

      return success({ user: result.user }, request.requestId);
    },
  );

  app.post('/refresh', { config: { requiredRole: Role.PUBLIC } }, async (request, reply) => {
    const refreshToken = request.cookies[REFRESH_TOKEN_COOKIE];
    if (!refreshToken) {
      throw new AppError('Refresh token expired or invalid', 'TOKEN_EXPIRED', 401);
    }

    const result = await authService.refresh(refreshToken, requestContext(request));

    setTokenCookies(reply, result.tokens, isProduction);
    const csrfToken = generateCsrfToken();
    setCsrfCookie(reply, csrfToken, isProduction);
    reply.header('X-CSRF-Token', csrfToken);

    return success({ user: result.user }, request.requestId);
  });

  app.post('/logout', { config: { requiredRole: Role.PUBLIC } }, async (request, reply) => {
    authService.logout(request.user?.sub, requestContext(request));
    clearTokenCookies(reply);
    return success({ message: 'Logged out successfully' }, request.requestId);
  });

  // Lets the SPA restore `{ id, email, role }` from the access-token
  // cookie after a page reload, without re-sending credentials — any
  // authenticated role may call it (Role.VIEWER is the floor, not a
  // permission check on the data itself).
  app.get('/me', { config: { requiredRole: Role.VIEWER } }, async (request) => {
    const user = request.user!;
    return success({ id: user.sub, email: user.email, role: user.role }, request.requestId);
  });
};
