import pino from 'pino';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { AuditLogger } from '../../../src/registries/audit-logger.js';
import { MetricRegistryService } from '../../../src/registries/metric-registry.service.js';
import { absoluteToleranceMetricFixture, mixedThresholdMetricFixture } from '../../fixtures/metrics.fixture.js';
import { createContractHarness } from '../data-adapter/setup.js';

/**
 * WO-024 AC: runs the identical MetricRegistryService test suite against
 * both DATA_ENGINE engines via the shared WO-012 harness — same pattern
 * as tool-registry.contract.test.ts (WO-023). Skips cleanly when that
 * engine's database isn't reachable.
 */

const harness = await createContractHarness();
const silentLogger = pino({ level: 'silent' });

describe.skipIf(!harness)(`MetricRegistryService contract (${harness?.engine ?? 'unavailable'})`, () => {
  let service: MetricRegistryService;

  beforeEach(async () => {
    await harness!.cleanup();
    const auditLogger = new AuditLogger(harness!.repositories.auditLog, silentLogger);
    service = new MetricRegistryService(harness!.repositories.metricRegistry, auditLogger);
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  it('register() persists a metric that get() can then retrieve', async () => {
    const created = await service.register(absoluteToleranceMetricFixture);
    const fetched = await service.get(created.id);
    expect(fetched.source_query).toBe(absoluteToleranceMetricFixture.source_query);
  });

  it('round-trips a nested thresholds payload with numeric precision intact (jsonb/Mixed parity)', async () => {
    const created = await service.register(mixedThresholdMetricFixture);
    const fetched = await service.get(created.id);

    expect(fetched.thresholds).toEqual(mixedThresholdMetricFixture.thresholds);
  });

  it('enforces the name unique constraint', async () => {
    await service.register(absoluteToleranceMetricFixture);
    await expect(service.register(absoluteToleranceMetricFixture)).rejects.toMatchObject({ code: 'DUPLICATE_ENTRY' });
  });

  it('list() paginates registered metrics', async () => {
    await service.register(absoluteToleranceMetricFixture);
    await service.register(mixedThresholdMetricFixture);

    const page = await service.list({ page: 1, limit: 1 });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
  });

  it('deregister() performs a hard delete', async () => {
    const created = await service.register(absoluteToleranceMetricFixture);
    await service.deregister(created.id);
    await expect(service.get(created.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
