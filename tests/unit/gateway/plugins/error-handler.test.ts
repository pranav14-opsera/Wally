import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../../../src/gateway/app.js';
import { Role } from '../../../../src/gateway/auth/roles.js';
import { AppError } from '../../../../src/gateway/utils/errors.js';
import { fakeGatewayContainer } from '../../../helpers/fake-gateway-container.js';

const PUBLIC = { config: { requiredRole: Role.PUBLIC } };

async function appWithTestRoutes() {
  const app = await buildApp(fakeGatewayContainer());

  app.get('/api/v1/test/app-error', PUBLIC, async () => {
    throw new AppError('missing thing', 'NOT_FOUND', 404, [{ field: 'id', message: 'unknown id' }]);
  });
  app.get('/api/v1/test/unknown-error', PUBLIC, async () => {
    throw new Error('sensitive internal detail');
  });
  app.get('/api/v1/test/non-error-throw', PUBLIC, async () => {
    throw 'a plain string was thrown';
  });
  app.get('/api/v1/test/zod-error', PUBLIC, async () => {
    z.object({ name: z.string() }).parse({});
  });

  return app;
}

describe('global error handler (via buildApp + inject)', () => {
  it('formats a thrown AppError using its own code, statusCode, and details', async () => {
    const app = await appWithTestRoutes();

    const response = await app.inject({ method: 'GET', url: '/api/v1/test/app-error' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND', message: 'missing thing', details: [{ field: 'id', message: 'unknown id' }] },
    });
    await app.close();
  });

  it('never leaks the original message or stack for an unknown thrown Error', async () => {
    const app = await appWithTestRoutes();

    const response = await app.inject({ method: 'GET', url: '/api/v1/test/unknown-error' });

    expect(response.statusCode).toBe(500);
    const body = response.json() as { error: { message: string } };
    expect(body.error.message).toBe('Internal server error');
    expect(response.body).not.toContain('sensitive internal detail');
    await app.close();
  });

  it('handles a non-Error value thrown without crashing (edge case)', async () => {
    const app = await appWithTestRoutes();

    const response = await app.inject({ method: 'GET', url: '/api/v1/test/non-error-throw' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ success: false, error: { code: 'INTERNAL_ERROR' } });
    await app.close();
  });

  it('maps a raw ZodError (thrown outside the Fastify schema pipeline) to a 400 validation envelope', async () => {
    const app = await appWithTestRoutes();

    const response = await app.inject({ method: 'GET', url: '/api/v1/test/zod-error' });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; details: unknown[] } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.length).toBeGreaterThan(0);
    await app.close();
  });
});
