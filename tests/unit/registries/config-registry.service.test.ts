import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { DuplicateKeyError, type IRepository } from '../../../src/adapters/data/index.js';
import { ConfigRegistryService } from '../../../src/registries/config-registry.service.js';
import type { ConfigEntry } from '../../../src/registries/types/config.types.js';
import { RegistryError, type IAuditLogger } from '../../../src/registries/types/registry.types.js';
import {
  authRateLimitFixture,
  emptyStringConfigFixture,
  enableCloudComputeFixture,
  gatewayCorsOriginsFixture,
  maxVuCountFixture,
} from '../../fixtures/config.fixture.js';

interface MockRepository {
  findById: Mock;
  findMany: Mock;
  create: Mock;
  createMany: Mock;
  update: Mock;
  delete: Mock;
  count: Mock;
  transaction: Mock;
}

function createMockRepository(): MockRepository {
  return {
    findById: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
    transaction: vi.fn(),
  };
}

function toEntity(input: typeof authRateLimitFixture, overrides: Partial<ConfigEntry> = {}): ConfigEntry {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'config-uuid-1',
    ...input,
    description: input.description ?? null,
    category: input.category ?? null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function findManyOneResult(entity: ConfigEntry | null) {
  return { items: entity ? [entity] : [], total: entity ? 1 : 0, hasNext: false };
}

let repository: MockRepository;
let auditLog: Mock;
let service: ConfigRegistryService;

beforeEach(() => {
  repository = createMockRepository();
  auditLog = vi.fn().mockResolvedValue(undefined);
  const auditLogger: IAuditLogger = { log: auditLog };
  service = new ConfigRegistryService(repository as unknown as IRepository<ConfigEntry>, auditLogger);
});

describe('ConfigRegistryService', () => {
  describe('register', () => {
    it('persists a new config entry and returns the created entity', async () => {
      const created = toEntity(authRateLimitFixture);
      repository.create.mockResolvedValue(created);

      const result = await service.register(authRateLimitFixture);

      expect(result).toEqual(created);
      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ key: 'rate_limits.auth_rate_limit' }));
    });

    it('rejects duplicate keys with RegistryError code DUPLICATE_ENTRY', async () => {
      repository.create.mockRejectedValue(new DuplicateKeyError('ConfigRegistryEntry', 'key'));

      await expect(service.register(authRateLimitFixture)).rejects.toMatchObject({ code: 'DUPLICATE_ENTRY' });
      expect(auditLog).not.toHaveBeenCalled();
    });

    describe('type-value validation', () => {
      it('accepts a valid number value', async () => {
        repository.create.mockResolvedValue(toEntity(maxVuCountFixture));
        await expect(service.register(maxVuCountFixture)).resolves.toBeDefined();
      });

      it('rejects a non-numeric value for data_type=number', async () => {
        await expect(
          service.register({ ...maxVuCountFixture, value: 'not-a-number' }),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        expect(repository.create).not.toHaveBeenCalled();
      });

      it('accepts "true"/"false" for data_type=boolean', async () => {
        repository.create.mockResolvedValue(toEntity(enableCloudComputeFixture));
        await expect(service.register(enableCloudComputeFixture)).resolves.toBeDefined();
      });

      it('rejects a non-boolean-literal value for data_type=boolean', async () => {
        await expect(
          service.register({ ...enableCloudComputeFixture, value: 'yes' }),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      });

      it('accepts valid JSON for data_type=json', async () => {
        repository.create.mockResolvedValue(toEntity(gatewayCorsOriginsFixture));
        await expect(service.register(gatewayCorsOriginsFixture)).resolves.toBeDefined();
      });

      it('rejects invalid JSON for data_type=json', async () => {
        await expect(
          service.register({ ...gatewayCorsOriginsFixture, value: '{not valid json' }),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      });

      it('accepts an empty string for data_type=string', async () => {
        repository.create.mockResolvedValue(toEntity(emptyStringConfigFixture));
        await expect(service.register(emptyStringConfigFixture)).resolves.toBeDefined();
      });
    });

    it('writes an audit log entry keyed by the config key (resource_id = key)', async () => {
      const created = toEntity(authRateLimitFixture);
      repository.create.mockResolvedValue(created);

      await service.register(authRateLimitFixture, 'actor-1');

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actor_id: 'actor-1',
          action: 'register',
          resource_type: 'config',
          resource_id: 'rate_limits.auth_rate_limit',
        }),
      );
    });
  });

  describe('get', () => {
    it('retrieves a config entry by key (not by id)', async () => {
      const entity = toEntity(authRateLimitFixture);
      repository.findMany.mockResolvedValue(findManyOneResult(entity));

      const result = await service.get('rate_limits.auth_rate_limit');

      expect(result).toEqual(entity);
      expect(repository.findMany).toHaveBeenCalledWith(
        { key: { operator: 'eq', value: 'rate_limits.auth_rate_limit' } },
        undefined,
        { kind: 'offset', offset: 0, limit: 1 },
      );
    });

    it('throws RegistryError NOT_FOUND for a missing key', async () => {
      repository.findMany.mockResolvedValue(findManyOneResult(null));

      await expect(service.get('does.not.exist')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('list', () => {
    it('filters by category when provided', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 0, hasNext: false });

      await service.list({ category: 'agent_limits' });

      expect(repository.findMany).toHaveBeenCalledWith(
        { category: { operator: 'eq', value: 'agent_limits' } },
        undefined,
        { kind: 'offset', offset: 0, limit: 20 },
      );
    });

    it('passes no filter when category is omitted', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 0, hasNext: false });

      await service.list();

      expect(repository.findMany).toHaveBeenCalledWith(undefined, undefined, { kind: 'offset', offset: 0, limit: 20 });
    });
  });

  describe('update', () => {
    it('updates value and re-validates it against the existing (immutable) data_type', async () => {
      const existing = toEntity(maxVuCountFixture);
      const updated = { ...existing, value: '750' };
      repository.findMany.mockResolvedValue(findManyOneResult(existing));
      repository.update.mockResolvedValue(updated);

      const result = await service.update('agent_limits.max_vu_count', { value: '750' });

      expect(result.value).toBe('750');
      expect(repository.update).toHaveBeenCalledWith(existing.id, { value: '750' });
    });

    it('rejects a new value that does not match the existing entry\'s data_type', async () => {
      const existing = toEntity(maxVuCountFixture);
      repository.findMany.mockResolvedValue(findManyOneResult(existing));

      await expect(
        service.update('agent_limits.max_vu_count', { value: 'not-a-number' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('rejects updates to a non-existent key with RegistryError NOT_FOUND', async () => {
      repository.findMany.mockResolvedValue(findManyOneResult(null));

      await expect(service.update('does.not.exist', { value: '1' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('the update schema does not accept a data_type field — it is structurally immutable', async () => {
      const existing = toEntity(maxVuCountFixture);
      repository.findMany.mockResolvedValue(findManyOneResult(existing));
      repository.update.mockResolvedValue(existing);

      await service.update('agent_limits.max_vu_count', { value: '1', data_type: 'boolean' } as unknown);

      // updateConfigSchema strips unknown/extra keys — data_type never
      // reaches repository.update().
      expect(repository.update).toHaveBeenCalledWith(existing.id, { value: '1' });
    });

    it('writes an audit log entry with old_value and new_value', async () => {
      const existing = toEntity(maxVuCountFixture);
      const updated = { ...existing, value: '750' };
      repository.findMany.mockResolvedValue(findManyOneResult(existing));
      repository.update.mockResolvedValue(updated);

      await service.update('agent_limits.max_vu_count', { value: '750' }, 'actor-2');

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actor_id: 'actor-2',
          action: 'update',
          resource_type: 'config',
          resource_id: 'agent_limits.max_vu_count',
          change_details: expect.objectContaining({ old_value: '500', new_value: '750' }),
        }),
      );
    });
  });

  describe('deregister', () => {
    it('performs a hard delete keyed by the config key', async () => {
      const existing = toEntity(authRateLimitFixture);
      repository.findMany.mockResolvedValue(findManyOneResult(existing));
      repository.delete.mockResolvedValue(undefined);

      await service.deregister('rate_limits.auth_rate_limit', 'actor-3');

      expect(repository.delete).toHaveBeenCalledWith(existing.id);
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'deregister', resource_type: 'config', resource_id: 'rate_limits.auth_rate_limit' }),
      );
    });

    it('rejects deregistering a non-existent key with RegistryError NOT_FOUND', async () => {
      repository.findMany.mockResolvedValue(findManyOneResult(null));

      await expect(service.deregister('does.not.exist')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(repository.delete).not.toHaveBeenCalled();
    });
  });
});

describe('RegistryError from ConfigRegistryService is a RegistryError instance', () => {
  it('exposes the code and context fields', () => {
    const error = new RegistryError('test', 'VALIDATION_ERROR', { key: 'x' });
    expect(error).toBeInstanceOf(RegistryError);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.context).toEqual({ key: 'x' });
  });
});
