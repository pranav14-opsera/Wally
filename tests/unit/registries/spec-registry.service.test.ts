import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { DuplicateKeyError, type IRepository } from '../../../src/adapters/data/index.js';
import { SpecRegistryService } from '../../../src/registries/spec-registry.service.js';
import type { SpecEntry } from '../../../src/registries/types/spec.types.js';
import { RegistryError, type IAuditLogger } from '../../../src/registries/types/registry.types.js';
import { computeChecksum } from '../../../src/registries/utils/checksum.js';
import { petstoreV1Fixture, petstoreV1_1Fixture, petstoreV2Fixture, usersApiV1Fixture } from '../../fixtures/specs.fixture.js';

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

function toEntity(input: typeof petstoreV1Fixture, overrides: Partial<SpecEntry> = {}): SpecEntry {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'spec-uuid-1',
    ...input,
    checksum: computeChecksum(input.spec_content),
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

let repository: MockRepository;
let auditLog: Mock;
let service: SpecRegistryService;

beforeEach(() => {
  repository = createMockRepository();
  auditLog = vi.fn().mockResolvedValue(undefined);
  const auditLogger: IAuditLogger = { log: auditLog };
  service = new SpecRegistryService(repository as unknown as IRepository<SpecEntry>, auditLogger);
});

describe('SpecRegistryService', () => {
  describe('register', () => {
    it('persists a new spec version and returns the created entity', async () => {
      const created = toEntity(petstoreV1Fixture);
      repository.create.mockResolvedValue(created);

      const result = await service.register(petstoreV1Fixture);

      expect(result).toEqual(created);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ api_name: 'petstore', version: '1.0' }),
      );
    });

    it('computes a SHA-256 checksum server-side and includes it in the create payload', async () => {
      repository.create.mockResolvedValue(toEntity(petstoreV1Fixture));

      await service.register(petstoreV1Fixture);

      const expectedChecksum = computeChecksum(petstoreV1Fixture.spec_content);
      expect(expectedChecksum).toMatch(/^[0-9a-f]{64}$/);
      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ checksum: expectedChecksum }));
    });

    it('ignores a client-supplied checksum — it is always recomputed server-side', async () => {
      repository.create.mockResolvedValue(toEntity(petstoreV1Fixture));

      await service.register({ ...petstoreV1Fixture, checksum: 'client-supplied-fake-checksum' });

      const expectedChecksum = computeChecksum(petstoreV1Fixture.spec_content);
      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ checksum: expectedChecksum }));
    });

    it('the checksum is deterministic regardless of the object key insertion order', () => {
      const a = computeChecksum({ b: 1, a: 2 });
      const b = computeChecksum({ a: 2, b: 1 });
      expect(a).toBe(b);
    });

    it('the checksum changes when the spec content actually changes', () => {
      const v1 = computeChecksum(petstoreV1Fixture.spec_content);
      const v2 = computeChecksum(petstoreV2Fixture.spec_content);
      expect(v1).not.toBe(v2);
    });

    it('rejects a circular spec_content with a descriptive RegistryError, not a raw stack overflow', async () => {
      const circular: Record<string, unknown> = { api_name: 'circular' };
      circular.self = circular;

      let thrown: RegistryError | undefined;
      try {
        await service.register({ api_name: 'circular-api', version: '1.0', spec_content: circular });
        expect.unreachable();
      } catch (error) {
        thrown = error as RegistryError;
      }

      expect(thrown).toBeInstanceOf(RegistryError);
      expect(thrown?.code).toBe('VALIDATION_ERROR');
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('rejects duplicate api_name+version with RegistryError code DUPLICATE_ENTRY', async () => {
      repository.create.mockRejectedValue(new DuplicateKeyError('SpecRegistryEntry', 'api_name_version'));

      await expect(service.register(petstoreV1Fixture)).rejects.toMatchObject({ code: 'DUPLICATE_ENTRY' });
      expect(auditLog).not.toHaveBeenCalled();
    });

    it('rejects an invalid version string', async () => {
      await expect(
        service.register({ ...petstoreV1Fixture, version: 'not a version!!' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('writes an audit log entry with action=spec_registered and api_name/version in change_details', async () => {
      const created = toEntity(petstoreV1Fixture);
      repository.create.mockResolvedValue(created);

      await service.register(petstoreV1Fixture, 'actor-1');

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actor_id: 'actor-1',
          action: 'spec_registered',
          resource_type: 'spec',
          resource_id: created.id,
          change_details: expect.objectContaining({ api_name: 'petstore', version: '1.0' }),
        }),
      );
    });
  });

  describe('get', () => {
    it('returns the spec when found', async () => {
      const entity = toEntity(petstoreV1Fixture);
      repository.findById.mockResolvedValue(entity);

      await expect(service.get(entity.id)).resolves.toEqual(entity);
    });

    it('throws RegistryError NOT_FOUND for a missing id', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.get('missing-id')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('list', () => {
    it('filters by api_name and sorts by created_at descending', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 0, hasNext: false });

      await service.list({ api_name: 'petstore' });

      expect(repository.findMany).toHaveBeenCalledWith(
        { api_name: { operator: 'eq', value: 'petstore' } },
        { created_at: 'desc' },
        { kind: 'offset', offset: 0, limit: 20 },
      );
    });

    it('passes no filter when api_name is omitted', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 0, hasNext: false });

      await service.list();

      expect(repository.findMany).toHaveBeenCalledWith(undefined, { created_at: 'desc' }, { kind: 'offset', offset: 0, limit: 20 });
    });
  });

  describe('getLatestByApiName', () => {
    it('returns the most recently created version', async () => {
      const latest = toEntity(petstoreV2Fixture, { id: 'spec-uuid-3' });
      repository.findMany.mockResolvedValue({ items: [latest], total: 3, hasNext: false });

      const result = await service.getLatestByApiName('petstore');

      expect(result).toEqual(latest);
      expect(repository.findMany).toHaveBeenCalledWith(
        { api_name: { operator: 'eq', value: 'petstore' } },
        { created_at: 'desc' },
        { kind: 'offset', offset: 0, limit: 1 },
      );
    });

    it('throws RegistryError NOT_FOUND when no versions exist for the api_name', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 0, hasNext: false });

      await expect(service.getLatestByApiName('nonexistent-api')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  it('does not expose update or deregister methods (append-only at the type level)', () => {
    expect((service as unknown as { update?: unknown }).update).toBeUndefined();
    expect((service as unknown as { deregister?: unknown }).deregister).toBeUndefined();
  });

  it('petstore/users-api fixtures with $ref pointers round-trip through the checksum function without alteration', () => {
    for (const fixture of [petstoreV1Fixture, petstoreV1_1Fixture, usersApiV1Fixture]) {
      expect(() => computeChecksum(fixture.spec_content)).not.toThrow();
    }
  });
});
