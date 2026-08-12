import { describe, expect, it } from 'vitest';

import { HealthService } from '../../../../src/gateway/services/health.service.js';
import type { DataAdapterContext } from '../../../../src/adapters/data/index.js';

function fakeDataAdapter(healthCheck: () => Promise<boolean>): DataAdapterContext {
  return {
    engine: 'postgres',
    repositories: {} as never,
    disconnect: async () => {},
    healthCheck,
  };
}

describe('HealthService.checkAll', () => {
  it('returns healthy with 200-worthy status when the database check succeeds', async () => {
    const service = new HealthService(fakeDataAdapter(async () => true), 1000);

    const result = await service.checkAll();

    expect(result.status).toBe('healthy');
    expect(result.dependencies).toEqual([{ name: 'database', status: 'healthy', latencyMs: expect.any(Number) }]);
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(new Date(result.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('reports unhealthy (not a thrown error) when the database check returns false', async () => {
    const service = new HealthService(fakeDataAdapter(async () => false), 1000);

    const result = await service.checkAll();

    expect(result.status).toBe('unhealthy');
    expect(result.dependencies[0]).toMatchObject({ name: 'database', status: 'unhealthy' });
    expect(result.dependencies[0]?.error).toEqual(expect.any(String));
  });

  it('reports unhealthy with the error message (not a stack trace) when the database check throws', async () => {
    const service = new HealthService(
      fakeDataAdapter(async () => {
        throw new Error('connection refused');
      }),
      1000,
    );

    const result = await service.checkAll();

    expect(result.dependencies[0]).toMatchObject({ status: 'unhealthy', error: 'connection refused' });
  });

  it('reports unhealthy, not hung, when the database check exceeds the configured timeout (edge case)', async () => {
    const service = new HealthService(
      fakeDataAdapter(() => new Promise((resolve) => setTimeout(() => resolve(true), 200))),
      20,
    );

    const result = await service.checkAll();

    expect(result.status).toBe('unhealthy');
    expect(result.dependencies[0]?.error).toContain('timed out');
  });

  it('never throws even when the dependency check rejects', async () => {
    const service = new HealthService(
      fakeDataAdapter(() => Promise.reject(new Error('boom'))),
      1000,
    );

    await expect(service.checkAll()).resolves.toBeDefined();
  });
});
