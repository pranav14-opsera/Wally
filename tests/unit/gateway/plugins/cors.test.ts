import { describe, expect, it } from 'vitest';

import { buildApp } from '../../../../src/gateway/app.js';
import { parseAllowedOrigins } from '../../../../src/gateway/plugins/cors.js';
import { fakeGatewayContainer } from '../../../helpers/fake-gateway-container.js';

describe('parseAllowedOrigins', () => {
  it('splits a comma-separated list and trims whitespace', () => {
    expect(parseAllowedOrigins('http://a.test, http://b.test ,http://c.test')).toEqual([
      'http://a.test',
      'http://b.test',
      'http://c.test',
    ]);
  });

  it('normalizes trailing slashes so they compare equal (edge case)', () => {
    expect(parseAllowedOrigins('http://a.test/')).toEqual(['http://a.test']);
  });

  it('drops empty entries from a trailing comma or blank env var segment', () => {
    expect(parseAllowedOrigins('http://a.test,,')).toEqual(['http://a.test']);
  });
});

describe('CORS plugin (via buildApp + inject)', () => {
  it('reflects an allowed origin on an actual request', async () => {
    const app = await buildApp(fakeGatewayContainer({ CORS_ALLOWED_ORIGINS: 'http://a.test,http://b.test' }));

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live', headers: { origin: 'http://b.test' } });

    expect(response.headers['access-control-allow-origin']).toBe('http://b.test');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    await app.close();
  });

  it('omits CORS headers for a disallowed origin', async () => {
    const app = await buildApp(fakeGatewayContainer({ CORS_ALLOWED_ORIGINS: 'http://a.test' }));

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live', headers: { origin: 'http://evil.test' } });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('does not crash and proceeds when the Origin header is missing (non-browser client)', async () => {
    const app = await buildApp(fakeGatewayContainer());

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('falls back to the default local origin when CORS_ALLOWED_ORIGINS is unset', async () => {
    const app = await buildApp(fakeGatewayContainer());

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health/live',
      headers: { origin: 'http://localhost:5173' },
    });

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    await app.close();
  });
});
