import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../../../src/gateway/app.js';
import { fakeGatewayContainer } from '../../helpers/fake-gateway-container.js';

describe('health endpoints (integration)', () => {
  it('GET /api/v1/health/live returns 200 with no auth and no dependency checks', async () => {
    const app = await buildApp(fakeGatewayContainer());
    await app.ready();

    const response = await request(app.server).get('/api/v1/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'alive', timestamp: expect.any(String) });
    await app.close();
  });

  it('GET /api/v1/health/ready returns 200 with dependency details when healthy', async () => {
    const app = await buildApp(fakeGatewayContainer());
    await app.ready();

    const response = await request(app.server).get('/api/v1/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'healthy', dependencies: [{ name: 'database', status: 'healthy' }] });
    await app.close();
  });

  it('GET /api/v1/health/ready returns 503 when the database is unreachable', async () => {
    const app = await buildApp(fakeGatewayContainer({}, [], async () => false));
    await app.ready();

    const response = await request(app.server).get('/api/v1/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ status: 'unhealthy' });
    await app.close();
  });

  it('GET /api/v1/health returns the same combined status as /ready', async () => {
    const app = await buildApp(fakeGatewayContainer({}, [], async () => false));
    await app.ready();

    const response = await request(app.server).get('/api/v1/health');

    expect(response.status).toBe(503);
    expect(response.body.dependencies).toHaveLength(1);
    await app.close();
  });

  it('requires no authentication on any health endpoint', async () => {
    const app = await buildApp(fakeGatewayContainer());
    await app.ready();

    for (const path of ['/api/v1/health', '/api/v1/health/live', '/api/v1/health/ready']) {
      const response = await request(app.server).get(path);
      expect(response.status).not.toBe(401);
    }
    await app.close();
  });
});
