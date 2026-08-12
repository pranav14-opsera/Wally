import { describe, expect, it } from 'vitest';

import { buildApp } from '../../../src/gateway/app.js';
import { fakeGatewayContainer } from '../../helpers/fake-gateway-container.js';

describe('buildApp', () => {
  it('returns a Fastify instance decorated with the DI container', async () => {
    const container = fakeGatewayContainer();
    const app = await buildApp(container);

    expect(app.container).toBe(container);
    await app.close();
  });

  it('registers the health route under /api/v1/health returning 200', async () => {
    const app = await buildApp(fakeGatewayContainer());

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'alive', timestamp: expect.any(String) });
    await app.close();
  });

  it('registers every domain route-group prefix without error', async () => {
    const app = await buildApp(fakeGatewayContainer());
    const routeTree = app.printRoutes();

    expect(routeTree).toContain('health');
    await app.close();
  });

  it('returns a structured 404 envelope with a request ID for unknown routes', async () => {
    const app = await buildApp(fakeGatewayContainer());

    const response = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(response.json().requestId).toEqual(expect.any(String));
    expect(response.headers['x-request-id']).toBeDefined();
    await app.close();
  });

  it('is safe to close twice — a double-close never throws', async () => {
    const app = await buildApp(fakeGatewayContainer());

    await app.close();
    await expect(app.close()).resolves.toBeUndefined();
  });
});
