import pino from 'pino';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { AuditLogger } from '../../../src/registries/audit-logger.js';
import { ToolRegistryService } from '../../../src/registries/tool-registry.service.js';
import { RegistryError } from '../../../src/registries/types/registry.types.js';
import { apiKeyToolFixture, oauth2ToolFixture } from '../../fixtures/tools.fixture.js';
import { createContractHarness } from '../data-adapter/setup.js';

/**
 * WO-023 AC10: runs the identical ToolRegistryService test suite against
 * both DATA_ENGINE engines via the shared WO-012 harness — proves the
 * service (not just the raw repository) behaves identically regardless
 * of engine, including the jsonb/Mixed `endpoints` round-trip and the
 * `name` unique constraint. Skips cleanly (like every other
 * *.contract.test.ts) when that engine's database isn't reachable.
 */

const harness = await createContractHarness();
const silentLogger = pino({ level: 'silent' });

describe.skipIf(!harness)(`ToolRegistryService contract (${harness?.engine ?? 'unavailable'})`, () => {
  let service: ToolRegistryService;

  beforeEach(async () => {
    await harness!.cleanup();
    const auditLogger = new AuditLogger(harness!.repositories.auditLog, silentLogger);
    service = new ToolRegistryService(harness!.repositories.toolRegistry, auditLogger);
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  it('register() persists a tool that get() can then retrieve', async () => {
    const created = await service.register(apiKeyToolFixture);
    expect(created.id).toBeTruthy();
    expect(created.name).toBe(apiKeyToolFixture.name);

    const fetched = await service.get(created.id);
    expect(fetched).toEqual(created);
  });

  it('round-trips a complex nested endpoints payload identically (jsonb/Mixed parity)', async () => {
    const created = await service.register(oauth2ToolFixture);
    const fetched = await service.get(created.id);

    expect(fetched.endpoints).toEqual(oauth2ToolFixture.endpoints);
  });

  it('enforces the name unique constraint — a second register() with the same name is DUPLICATE_ENTRY', async () => {
    await service.register(apiKeyToolFixture);

    await expect(service.register(apiKeyToolFixture)).rejects.toMatchObject({ code: 'DUPLICATE_ENTRY' });
  });

  it('list() paginates registered tools', async () => {
    await service.register(apiKeyToolFixture);
    await service.register(oauth2ToolFixture);

    const page = await service.list({ page: 1, limit: 1 });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
  });

  it('update() persists a partial change and writes an audit entry', async () => {
    const created = await service.register(apiKeyToolFixture);
    const updated = await service.update(created.id, { description: 'Contract-test updated description' }, 'actor-1');
    expect(updated.description).toBe('Contract-test updated description');

    const auditEntries = await harness!.repositories.auditLog.findMany({
      resource_id: { operator: 'eq', value: created.id },
    });
    const updateEntry = auditEntries.items.find((entry) => entry.action === 'update');
    expect(updateEntry).toBeDefined();
    expect(updateEntry?.actor_id).toBe('actor-1');
  });

  it('deregister() performs a hard delete — a subsequent get() throws NOT_FOUND', async () => {
    const created = await service.register(apiKeyToolFixture);
    await service.deregister(created.id);

    await expect(service.get(created.id)).rejects.toBeInstanceOf(RegistryError);
  });

  it('every mutation (register/update/deregister) writes an audit log entry', async () => {
    const created = await service.register(apiKeyToolFixture, 'actor-2');
    await service.update(created.id, { description: 'x' }, 'actor-2');
    await service.deregister(created.id, 'actor-2');

    const auditEntries = await harness!.repositories.auditLog.findMany({
      resource_id: { operator: 'eq', value: created.id },
    });
    const actions = auditEntries.items.map((entry) => entry.action).sort();
    expect(actions).toEqual(['deregister', 'register', 'update']);
  });
});
