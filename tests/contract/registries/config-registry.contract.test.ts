import pino from 'pino';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { AuditLogger } from '../../../src/registries/audit-logger.js';
import { ConfigRegistryService } from '../../../src/registries/config-registry.service.js';
import { authRateLimitFixture, gatewayCorsOriginsFixture, maxVuCountFixture } from '../../fixtures/config.fixture.js';
import { createContractHarness } from '../data-adapter/setup.js';

/**
 * WO-025 AC: runs the identical ConfigRegistryService test suite against
 * both DATA_ENGINE engines via the shared WO-012 harness — same pattern
 * as tool/metric-registry.contract.test.ts. Skips cleanly when that
 * engine's database isn't reachable.
 */

const harness = await createContractHarness();
const silentLogger = pino({ level: 'silent' });

describe.skipIf(!harness)(`ConfigRegistryService contract (${harness?.engine ?? 'unavailable'})`, () => {
  let service: ConfigRegistryService;

  beforeEach(async () => {
    await harness!.cleanup();
    const auditLogger = new AuditLogger(harness!.repositories.auditLog, silentLogger);
    service = new ConfigRegistryService(harness!.repositories.configRegistry, auditLogger);
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  it('register() persists a config entry that get() can retrieve by key', async () => {
    const created = await service.register(authRateLimitFixture);
    const fetched = await service.get(authRateLimitFixture.key);
    expect(fetched.id).toBe(created.id);
    expect(fetched.value).toBe('10');
  });

  it('round-trips a JSON value with precision/structure intact', async () => {
    await service.register(gatewayCorsOriginsFixture);
    const fetched = await service.get(gatewayCorsOriginsFixture.key);
    expect(JSON.parse(fetched.value)).toEqual(JSON.parse(gatewayCorsOriginsFixture.value));
  });

  it('enforces the key unique constraint', async () => {
    await service.register(authRateLimitFixture);
    await expect(service.register(authRateLimitFixture)).rejects.toMatchObject({ code: 'DUPLICATE_ENTRY' });
  });

  it('list() filters by category', async () => {
    await service.register(authRateLimitFixture);
    await service.register(maxVuCountFixture);

    const rateLimits = await service.list({ category: 'rate_limits' });
    expect(rateLimits.total).toBe(1);
    expect(rateLimits.items[0]?.key).toBe(authRateLimitFixture.key);
  });

  it('update() changes the value and get() reflects it immediately (no caching)', async () => {
    await service.register(maxVuCountFixture);
    await service.update(maxVuCountFixture.key, { value: '750' });

    const fetched = await service.get(maxVuCountFixture.key);
    expect(fetched.value).toBe('750');
  });

  it('deregister() performs a hard delete by key', async () => {
    await service.register(authRateLimitFixture);
    await service.deregister(authRateLimitFixture.key);

    await expect(service.get(authRateLimitFixture.key)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
