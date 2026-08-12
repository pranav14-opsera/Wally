import { describe, expect, it } from 'vitest';

import { buildApp } from '../../../../src/gateway/app.js';
import { fakeGatewayContainer } from '../../../helpers/fake-gateway-container.js';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('request-id plugin (via buildApp + inject)', () => {
  it('sets a valid UUID v4 on the X-Request-ID response header', async () => {
    const app = await buildApp(fakeGatewayContainer());

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });

    expect(response.headers['x-request-id']).toMatch(UUID_V4_PATTERN);
    await app.close();
  });

  it('generates a fresh request ID per request rather than reusing a client-supplied one', async () => {
    const app = await buildApp(fakeGatewayContainer());

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health/live',
      headers: { 'x-request-id': 'not-a-uuid' },
    });

    expect(response.headers['x-request-id']).toMatch(UUID_V4_PATTERN);
    expect(response.headers['x-request-id']).not.toBe('not-a-uuid');
    await app.close();
  });

  it('generates a different request ID for each request', async () => {
    const app = await buildApp(fakeGatewayContainer());

    const first = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
    const second = await app.inject({ method: 'GET', url: '/api/v1/health/live' });

    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
    await app.close();
  });
});
