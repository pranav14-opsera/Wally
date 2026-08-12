import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../../src/gateway/app.js';
import { fakeGatewayContainer } from '../../helpers/fake-gateway-container.js';

describe('gateway app (integration, real HTTP socket via Supertest)', () => {
  const app = Object.assign({}, { instance: undefined as Awaited<ReturnType<typeof buildApp>> | undefined });

  beforeAll(async () => {
    app.instance = await buildApp(fakeGatewayContainer());
    await app.instance.ready();
  });

  afterAll(async () => {
    await app.instance?.close();
  });

  it('responds 200 to a health probe at /api/v1/health/live', async () => {
    const response = await request(app.instance!.server).get('/api/v1/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'alive', timestamp: expect.any(String) });
  });

  it('responds 404 with a structured error envelope for unknown routes', async () => {
    const response = await request(app.instance!.server).get('/api/v1/nope');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('every response carries the WO-038 security headers', async () => {
    const response = await request(app.instance!.server).get('/api/v1/health/live');

    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(response.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('responds to CORS preflight with 204 and the configured allowed origin', async () => {
    const response = await request(app.instance!.server)
      .options('/api/v1/health/live')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('omits CORS headers for a disallowed origin', async () => {
    const response = await request(app.instance!.server).get('/api/v1/health/live').set('Origin', 'http://evil.example.com');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
