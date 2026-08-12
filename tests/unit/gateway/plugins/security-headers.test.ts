import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../../../src/gateway/app.js';
import { fakeGatewayContainer } from '../../../helpers/fake-gateway-container.js';

describe('security headers plugin (via buildApp + inject)', () => {
  it('sets every required security header and removes X-Powered-By', async () => {
    const app = await buildApp(fakeGatewayContainer());

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });

    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(response.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
    expect(response.headers['x-powered-by']).toBeUndefined();
    await app.close();
  });

  it('does not set HSTS outside production', async () => {
    const app = await buildApp(fakeGatewayContainer({ NODE_ENV: 'development' }));

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });

    expect(response.headers['strict-transport-security']).toBeUndefined();
    await app.close();
  });

  it('sets HSTS with max-age and includeSubDomains in production', async () => {
    const app = await buildApp(fakeGatewayContainer({ NODE_ENV: 'production' }));

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });

    expect(response.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    await app.close();
  });

  it('applies a CSP_DIRECTIVES override when valid', async () => {
    const app = await buildApp(fakeGatewayContainer({ CSP_DIRECTIVES: "default-src 'none'" }));

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });

    expect(response.headers['content-security-policy']).toBe("default-src 'none'");
    await app.close();
  });

  it('falls back to the environment default and logs a warning when CSP_DIRECTIVES is malformed', async () => {
    const container = fakeGatewayContainer({ NODE_ENV: 'development', CSP_DIRECTIVES: 'not-a-valid-csp-string' });
    const warnSpy = vi.spyOn(container.logger, 'warn');

    const app = await buildApp(container);
    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });

    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ csp: 'not-a-valid-csp-string' }),
      expect.stringContaining('malformed'),
    );
    await app.close();
  });

  it('still sets security headers on a 404 response (edge case: no matching route)', async () => {
    const app = await buildApp(fakeGatewayContainer());

    const response = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });

    expect(response.headers['x-frame-options']).toBe('DENY');
    await app.close();
  });
});
