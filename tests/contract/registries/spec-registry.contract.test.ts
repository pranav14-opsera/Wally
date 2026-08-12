import pino from 'pino';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { AuditLogger } from '../../../src/registries/audit-logger.js';
import { SpecRegistryService } from '../../../src/registries/spec-registry.service.js';
import { petstoreV1Fixture, petstoreV1_1Fixture, petstoreV2Fixture, usersApiV1Fixture } from '../../fixtures/specs.fixture.js';
import { createContractHarness } from '../data-adapter/setup.js';

/**
 * WO-026 AC: runs the identical SpecRegistryService test suite against
 * both DATA_ENGINE engines via the shared WO-012 harness — same pattern
 * as tool/metric/config-registry.contract.test.ts. Skips cleanly when
 * that engine's database isn't reachable.
 */

const harness = await createContractHarness();
const silentLogger = pino({ level: 'silent' });

describe.skipIf(!harness)(`SpecRegistryService contract (${harness?.engine ?? 'unavailable'})`, () => {
  let service: SpecRegistryService;

  beforeEach(async () => {
    await harness!.cleanup();
    const auditLogger = new AuditLogger(harness!.repositories.auditLog, silentLogger);
    service = new SpecRegistryService(harness!.repositories.specRegistry, auditLogger);
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  it('register() persists a spec that get() can then retrieve, with the full $ref-containing content intact', async () => {
    const created = await service.register(petstoreV1Fixture);
    const fetched = await service.get(created.id);

    expect(fetched.spec_content).toEqual(petstoreV1Fixture.spec_content);
    expect(fetched.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('enforces the composite (api_name, version) unique constraint', async () => {
    await service.register(petstoreV1Fixture);
    await expect(service.register(petstoreV1Fixture)).rejects.toMatchObject({ code: 'DUPLICATE_ENTRY' });
  });

  it('list() filters by api_name and orders by created_at descending', async () => {
    await service.register(petstoreV1Fixture);
    await service.register(petstoreV1_1Fixture);
    await service.register(usersApiV1Fixture);

    const page = await service.list({ api_name: 'petstore' });
    expect(page.total).toBe(2);
    expect(page.items.every((item) => item.api_name === 'petstore')).toBe(true);
    expect(page.items[0]?.version).toBe('1.1');
  });

  it('getLatestByApiName() returns the most recently registered version', async () => {
    await service.register(petstoreV1Fixture);
    await service.register(petstoreV1_1Fixture);
    await service.register(petstoreV2Fixture);

    const latest = await service.getLatestByApiName('petstore');
    expect(latest.version).toBe('2.0');
  });

  it('getLatestByApiName() throws NOT_FOUND for an api_name with no registered specs', async () => {
    await expect(service.getLatestByApiName('never-registered')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
