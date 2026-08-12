import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../../../src/gateway/app.js';
import { Role } from '../../../src/gateway/auth/roles.js';
import { fakeGatewayContainer, fakeUser } from '../../helpers/fake-gateway-container.js';

const PASSWORD = 'correct-horse-battery-staple';

async function appWithProtectedTestRoute() {
  const user = fakeUser({ email: 'admin@wally.test' });
  const app = await buildApp(fakeGatewayContainer({}, [user]));

  app.get('/api/v1/test/protected', { config: { requiredRole: Role.VIEWER } }, async () => ({ secret: 'data' }));
  app.post('/api/v1/test/protected-mutation', { config: { requiredRole: Role.VIEWER } }, async () => ({ mutated: true }));

  await app.ready();
  return { app, user };
}

function csrfFrom(response: request.Response): string {
  const token = response.headers['x-csrf-token'] as string | undefined;
  if (!token) {
    throw new Error('expected X-CSRF-Token header on response');
  }
  return token;
}

describe('auth REST endpoints (login/refresh/logout, integration)', () => {
  it('logs in with valid credentials, sets httpOnly cookies, and returns a CSRF token', async () => {
    const { app, user } = await appWithProtectedTestRoute();

    const response = await request(app.server).post('/api/v1/auth/login').send({ username: user.email, password: PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { user: { id: user.id, email: user.email, role: user.role } } });
    expect(response.headers['x-csrf-token']).toEqual(expect.any(String));
    const setCookie = response.headers['set-cookie'] as unknown as string[];
    expect(setCookie.some((c) => c.startsWith('access_token=') && c.includes('HttpOnly'))).toBe(true);
    expect(setCookie.some((c) => c.startsWith('refresh_token=') && c.includes('HttpOnly'))).toBe(true);
    expect(setCookie.some((c) => c.startsWith('csrf_token=') && !c.includes('HttpOnly'))).toBe(true);
    expect(JSON.stringify(response.body)).not.toMatch(/eyJ/); // no JWT ever appears in the response body
    await app.close();
  });

  it('rejects invalid credentials with a generic 401 (never reveals which field was wrong)', async () => {
    const { app } = await appWithProtectedTestRoute();

    const response = await request(app.server).post('/api/v1/auth/login').send({ username: 'nobody@test.com', password: PASSWORD });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ success: false, error: { code: 'AUTHENTICATION_ERROR' } });
    await app.close();
  });

  it('allows access to a protected route using the cookie + CSRF header from login', async () => {
    const { app, user } = await appWithProtectedTestRoute();
    const agent = request.agent(app.server);

    const login = await agent.post('/api/v1/auth/login').send({ username: user.email, password: PASSWORD });
    const csrfToken = csrfFrom(login);

    const protectedGet = await agent.get('/api/v1/test/protected');
    expect(protectedGet.status).toBe(200);

    const protectedMutation = await agent.post('/api/v1/test/protected-mutation').set('X-CSRF-Token', csrfToken);
    expect(protectedMutation.status).toBe(200);
    await app.close();
  });

  it('rejects a mutating cookie-auth request missing the CSRF header with 403', async () => {
    const { app, user } = await appWithProtectedTestRoute();
    const agent = request.agent(app.server);
    await agent.post('/api/v1/auth/login').send({ username: user.email, password: PASSWORD });

    const response = await agent.post('/api/v1/test/protected-mutation');

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'CSRF_VALIDATION_FAILED' } });
    await app.close();
  });

  it('rotates tokens on refresh and returns a fresh CSRF token', async () => {
    const { app, user } = await appWithProtectedTestRoute();
    const agent = request.agent(app.server);
    const login = await agent.post('/api/v1/auth/login').send({ username: user.email, password: PASSWORD });

    const refresh = await agent.post('/api/v1/auth/refresh');

    expect(refresh.status).toBe(200);
    expect(refresh.headers['x-csrf-token']).not.toBe(csrfFrom(login));
    await app.close();
  });

  it('rejects refresh with no refresh token cookie present', async () => {
    const { app } = await appWithProtectedTestRoute();

    const response = await request(app.server).post('/api/v1/auth/refresh');

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: { code: 'TOKEN_EXPIRED' } });
    await app.close();
  });

  it('clears auth cookies on logout', async () => {
    const { app, user } = await appWithProtectedTestRoute();
    const agent = request.agent(app.server);
    await agent.post('/api/v1/auth/login').send({ username: user.email, password: PASSWORD });

    const response = await agent.post('/api/v1/auth/logout');

    expect(response.status).toBe(200);
    const setCookie = response.headers['set-cookie'] as unknown as string[];
    expect(setCookie.some((c) => c.startsWith('access_token=;') || c.includes('access_token=;'))).toBe(true);
    await app.close();
  });

  it('GET /me returns the authenticated user from the access token', async () => {
    const { app, user } = await appWithProtectedTestRoute();
    const agent = request.agent(app.server);
    await agent.post('/api/v1/auth/login').send({ username: user.email, password: PASSWORD });

    const response = await agent.get('/api/v1/auth/me');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ id: user.id, email: user.email, role: user.role });
    await app.close();
  });

  it('GET /me returns 401 without a token', async () => {
    const { app } = await appWithProtectedTestRoute();

    const response = await request(app.server).get('/api/v1/auth/me');

    expect(response.status).toBe(401);
    await app.close();
  });

  it('accepts Bearer auth without requiring a CSRF header (non-browser client)', async () => {
    const { app, user } = await appWithProtectedTestRoute();
    const token = app.jwt.generateAccessToken(user.id, user.email, user.role);

    const response = await request(app.server).post('/api/v1/test/protected-mutation').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    await app.close();
  });
});
