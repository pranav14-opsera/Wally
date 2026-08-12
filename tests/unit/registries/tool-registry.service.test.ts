import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { DuplicateKeyError, EntityNotFoundError, type IRepository } from '../../../src/adapters/data/index.js';
import { AuditLogger } from '../../../src/registries/audit-logger.js';
import { ToolRegistryService } from '../../../src/registries/tool-registry.service.js';
import type { ToolDefinition } from '../../../src/registries/types/tool.types.js';
import { RegistryError, type IAuditLogger } from '../../../src/registries/types/registry.types.js';
import { apiKeyToolFixture, noAuthToolFixture, oauth2ToolFixture } from '../../fixtures/tools.fixture.js';

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

function toEntity(input: typeof apiKeyToolFixture, overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'tool-uuid-1',
    ...input,
    credential_ref: input.credential_ref ?? null,
    health_status: 'unknown',
    last_health_check: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

let repository: MockRepository;
let auditLogger: IAuditLogger;
let auditLog: Mock;
let service: ToolRegistryService;

beforeEach(() => {
  repository = createMockRepository();
  auditLog = vi.fn().mockResolvedValue(undefined);
  auditLogger = { log: auditLog };
  service = new ToolRegistryService(repository as unknown as IRepository<ToolDefinition>, auditLogger);
});

describe('ToolRegistryService', () => {
  describe('register', () => {
    it('persists a new tool and returns the created entity with a generated id', async () => {
      const created = toEntity(apiKeyToolFixture);
      repository.create.mockResolvedValue(created);

      const result = await service.register(apiKeyToolFixture);

      expect(result).toEqual(created);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'weather-api',
          auth_type: 'api_key',
          health_status: 'unknown',
          last_health_check: null,
        }),
      );
    });

    it('defaults credential_ref to null when omitted', async () => {
      const created = toEntity(noAuthToolFixture);
      repository.create.mockResolvedValue(created);

      await service.register(noAuthToolFixture);

      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ credential_ref: null }));
    });

    it('normalizes a missing endpoints field to an empty array', async () => {
      const { endpoints: _omit, ...withoutEndpoints } = noAuthToolFixture;
      const created = toEntity(noAuthToolFixture);
      repository.create.mockResolvedValue(created);

      await service.register(withoutEndpoints);

      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ endpoints: [] }));
    });

    it('description is optional — a missing description defaults to null', async () => {
      const { description: _omit, ...withoutDescription } = noAuthToolFixture;
      const created = toEntity(noAuthToolFixture, { description: null });
      repository.create.mockResolvedValue(created);

      await service.register(withoutDescription);

      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ description: null }));
    });

    it('rejects duplicate tool names with a RegistryError code DUPLICATE_ENTRY', async () => {
      repository.create.mockRejectedValue(new DuplicateKeyError('ToolRegistryEntry', 'name'));

      let thrown: RegistryError | undefined;
      try {
        await service.register(apiKeyToolFixture);
        expect.unreachable();
      } catch (error) {
        thrown = error as RegistryError;
      }

      expect(thrown).toBeInstanceOf(RegistryError);
      expect(thrown?.code).toBe('DUPLICATE_ENTRY');
      expect(auditLog).not.toHaveBeenCalled();
    });

    it('rejects invalid input with RegistryError code VALIDATION_ERROR without calling the repository', async () => {
      let thrown: RegistryError | undefined;
      try {
        await service.register({ ...apiKeyToolFixture, base_url: 'not-a-url' });
        expect.unreachable();
      } catch (error) {
        thrown = error as RegistryError;
      }

      expect(thrown).toBeInstanceOf(RegistryError);
      expect(thrown?.code).toBe('VALIDATION_ERROR');
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('rejects an invalid auth_type not in the enum', async () => {
      await expect(
        service.register({ ...apiKeyToolFixture, auth_type: 'not-a-real-type' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('writes an audit log entry with actor_id, action, resource_type, resource_id, and change_details', async () => {
      const created = toEntity(apiKeyToolFixture);
      repository.create.mockResolvedValue(created);

      await service.register(apiKeyToolFixture, 'actor-1');

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actor_id: 'actor-1',
          action: 'register',
          resource_type: 'tool',
          resource_id: created.id,
          change_details: expect.objectContaining({ after: expect.objectContaining({ name: 'weather-api' }) }),
        }),
      );
    });

    it('accepts a null actor_id when none is provided', async () => {
      const created = toEntity(apiKeyToolFixture);
      repository.create.mockResolvedValue(created);

      await service.register(apiKeyToolFixture);

      expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ actor_id: null }));
    });
  });

  describe('get', () => {
    it('returns the tool when found', async () => {
      const entity = toEntity(apiKeyToolFixture);
      repository.findById.mockResolvedValue(entity);

      await expect(service.get(entity.id)).resolves.toEqual(entity);
    });

    it('throws RegistryError NOT_FOUND when the tool does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.get('missing-id')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('list', () => {
    it('defaults to page=1 limit=20 and translates to offset pagination', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 0, hasNext: false });

      const result = await service.list();

      expect(repository.findMany).toHaveBeenCalledWith(undefined, undefined, {
        kind: 'offset',
        offset: 0,
        limit: 20,
      });
      expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20 });
    });

    it('computes offset correctly for page > 1', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 45, hasNext: true });

      const result = await service.list({ page: 3, limit: 10 });

      expect(repository.findMany).toHaveBeenCalledWith(undefined, undefined, {
        kind: 'offset',
        offset: 20,
        limit: 10,
      });
      expect(result).toEqual({ items: [], total: 45, page: 3, limit: 10 });
    });

    it('returns the items and total from the repository', async () => {
      const items = [toEntity(apiKeyToolFixture), toEntity(oauth2ToolFixture, { id: 'tool-uuid-2' })];
      repository.findMany.mockResolvedValue({ items, total: 2, hasNext: false });

      const result = await service.list();

      expect(result.items).toEqual(items);
      expect(result.total).toBe(2);
    });
  });

  describe('update', () => {
    it('merges partial updates and returns the updated entity', async () => {
      const existing = toEntity(apiKeyToolFixture);
      const updated = { ...existing, description: 'Updated description' };
      repository.findById.mockResolvedValue(existing);
      repository.update.mockResolvedValue(updated);

      const result = await service.update(existing.id, { description: 'Updated description' });

      expect(result).toEqual(updated);
      expect(repository.update).toHaveBeenCalledWith(existing.id, { description: 'Updated description' });
    });

    it('rejects updates to non-existent tools with RegistryError NOT_FOUND, without calling repository.update', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.update('missing-id', { description: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('rejects a name conflict with RegistryError DUPLICATE_ENTRY', async () => {
      const existing = toEntity(apiKeyToolFixture);
      repository.findById.mockResolvedValue(existing);
      repository.update.mockRejectedValue(new DuplicateKeyError('ToolRegistryEntry', 'name'));

      await expect(service.update(existing.id, { name: 'crm-connector' })).rejects.toMatchObject({
        code: 'DUPLICATE_ENTRY',
      });
    });

    it('maps a repository-level EntityNotFoundError (race between the pre-check and the update) to RegistryError NOT_FOUND', async () => {
      const existing = toEntity(apiKeyToolFixture);
      repository.findById.mockResolvedValue(existing);
      repository.update.mockRejectedValue(new EntityNotFoundError('ToolRegistryEntry', existing.id));

      await expect(service.update(existing.id, { description: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('writes an audit log entry with before/after change_details', async () => {
      const existing = toEntity(apiKeyToolFixture);
      const updated = { ...existing, description: 'Updated' };
      repository.findById.mockResolvedValue(existing);
      repository.update.mockResolvedValue(updated);

      await service.update(existing.id, { description: 'Updated' }, 'actor-2');

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actor_id: 'actor-2',
          action: 'update',
          resource_type: 'tool',
          resource_id: existing.id,
          change_details: { before: existing, after: { description: 'Updated' } },
        }),
      );
    });
  });

  describe('deregister', () => {
    it('performs a hard delete and writes an audit log entry', async () => {
      const existing = toEntity(apiKeyToolFixture);
      repository.findById.mockResolvedValue(existing);
      repository.delete.mockResolvedValue(undefined);

      await service.deregister(existing.id, 'actor-3');

      expect(repository.delete).toHaveBeenCalledWith(existing.id);
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actor_id: 'actor-3',
          action: 'deregister',
          resource_type: 'tool',
          resource_id: existing.id,
          change_details: { before: existing },
        }),
      );
    });

    it('rejects deregistering a non-existent tool with RegistryError NOT_FOUND, without calling repository.delete', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.deregister('missing-id')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('still deletes a tool that has a credential_ref — cleanup is the caller\'s responsibility', async () => {
      const existing = toEntity(apiKeyToolFixture, { credential_ref: 'secrets/still-active' });
      repository.findById.mockResolvedValue(existing);
      repository.delete.mockResolvedValue(undefined);

      await expect(service.deregister(existing.id)).resolves.toBeUndefined();
      expect(repository.delete).toHaveBeenCalledWith(existing.id);
    });
  });
});

describe('AuditLogger', () => {
  it('writes an audit record via the injected repository', async () => {
    const create = vi.fn().mockResolvedValue({});
    const repository = { create } as unknown as IRepository<never>;
    const silentLogger = { warn: vi.fn() } as unknown as import('pino').Logger;
    const auditLogger = new AuditLogger(repository, silentLogger);

    await auditLogger.log({
      actor_id: 'actor-1',
      action: 'register',
      resource_type: 'tool',
      resource_id: 'tool-1',
      change_details: { after: { name: 'x' } },
    });

    expect(create).toHaveBeenCalledWith({
      actor_id: 'actor-1',
      action: 'register',
      resource_type: 'tool',
      resource_id: 'tool-1',
      change_details: { after: { name: 'x' } },
      ip_address: null,
      user_agent: null,
    });
  });

  it('never rejects — a write failure is logged as a warning and swallowed', async () => {
    const create = vi.fn().mockRejectedValue(new Error('db down'));
    const repository = { create } as unknown as IRepository<never>;
    const warn = vi.fn();
    const logger = { warn } as unknown as import('pino').Logger;
    const auditLogger = new AuditLogger(repository, logger);

    await expect(
      auditLogger.log({
        actor_id: null,
        action: 'register',
        resource_type: 'tool',
        resource_id: 'tool-1',
        change_details: null,
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
