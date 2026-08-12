import { describe, expect, it } from 'vitest';

import { buildApp } from '../../../../src/gateway/app.js';
import { Role } from '../../../../src/gateway/auth/roles.js';
import { fakeGatewayContainer } from '../../../helpers/fake-gateway-container.js';

async function appWithRbacTestRoutes() {
  const app = await buildApp(fakeGatewayContainer());

  app.get('/api/v1/test/public', { config: { requiredRole: Role.PUBLIC } }, async () => ({ ok: true }));
  app.get('/api/v1/test/viewer-only', { config: { requiredRole: Role.VIEWER } }, async () => ({ ok: true }));
  app.get('/api/v1/test/manager-only', { config: { requiredRole: Role.MANAGER } }, async () => ({ ok: true }));
  app.get('/api/v1/test/admin-only', { config: { requiredRole: Role.ADMIN } }, async () => ({ ok: true }));
  // Deliberately no `config.requiredRole` — deny-by-default (WO-041 AC5).
  app.get('/api/v1/test/undeclared', async () => ({ ok: true }));

  return app;
}

function bearer(app: Awaited<ReturnType<typeof buildApp>>, role: Role) {
  return `Bearer ${app.jwt.generateAccessToken('user-1', 'a@test.com', role)}`;
}

describe('RBAC middleware (via buildApp + inject)', () => {
  it('allows public routes without any token', async () => {
    const app = await appWithRbacTestRoutes();

    const response = await app.inject({ method: 'GET', url: '/api/v1/test/public' });

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('denies a route with no requiredRole configured, even with a valid Admin token (deny-by-default)', async () => {
    const app = await appWithRbacTestRoutes();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/test/undeclared',
      headers: { authorization: bearer(app, Role.ADMIN) },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'AUTHORIZATION_ERROR' } });
    await app.close();
  });

  it('allows Admin to access a Manager-required route (role hierarchy)', async () => {
    const app = await appWithRbacTestRoutes();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/test/manager-only',
      headers: { authorization: bearer(app, Role.ADMIN) },
    });

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('denies Viewer access to a Manager-required route with 403 AUTHORIZATION_ERROR', async () => {
    const app = await appWithRbacTestRoutes();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/test/manager-only',
      headers: { authorization: bearer(app, Role.VIEWER) },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'AUTHORIZATION_ERROR' } });
    await app.close();
  });

  it('returns 401, not 403, when no token is present at all on a protected route', async () => {
    const app = await appWithRbacTestRoutes();

    const response = await app.inject({ method: 'GET', url: '/api/v1/test/viewer-only' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'AUTHENTICATION_ERROR' } });
    await app.close();
  });

  it('lets Viewer through on a Viewer-required route', async () => {
    const app = await appWithRbacTestRoutes();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/test/viewer-only',
      headers: { authorization: bearer(app, Role.VIEWER) },
    });

    expect(response.statusCode).toBe(200);
    await app.close();
  });
});
