import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { DuplicateKeyError, EntityNotFoundError, type IRepository } from '../../../src/adapters/data/index.js';
import { MetricRegistryService } from '../../../src/registries/metric-registry.service.js';
import type { MetricDefinition } from '../../../src/registries/types/metric.types.js';
import { RegistryError, type IAuditLogger } from '../../../src/registries/types/registry.types.js';
import {
  absoluteToleranceMetricFixture,
  noThresholdMetricFixture,
  percentageDriftMetricFixture,
  specialCharsSourceQueryMetricFixture,
} from '../../fixtures/metrics.fixture.js';

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

function toEntity(
  input: typeof percentageDriftMetricFixture,
  overrides: Partial<MetricDefinition> = {},
): MetricDefinition {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'metric-uuid-1',
    ...input,
    description: input.description ?? null,
    dashboard_ref: input.dashboard_ref ?? null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

let repository: MockRepository;
let auditLog: Mock;
let service: MetricRegistryService;

beforeEach(() => {
  repository = createMockRepository();
  auditLog = vi.fn().mockResolvedValue(undefined);
  const auditLogger: IAuditLogger = { log: auditLog };
  service = new MetricRegistryService(repository as unknown as IRepository<MetricDefinition>, auditLogger);
});

describe('MetricRegistryService', () => {
  describe('register', () => {
    it('persists a new metric and returns the created entity with a generated id', async () => {
      const created = toEntity(percentageDriftMetricFixture);
      repository.create.mockResolvedValue(created);

      const result = await service.register(percentageDriftMetricFixture);

      expect(result).toEqual(created);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'p95_latency_ms', source_query: percentageDriftMetricFixture.source_query }),
      );
    });

    it('rejects duplicate metric names with RegistryError code DUPLICATE_ENTRY', async () => {
      repository.create.mockRejectedValue(new DuplicateKeyError('MetricRegistryEntry', 'name'));

      await expect(service.register(percentageDriftMetricFixture)).rejects.toMatchObject({ code: 'DUPLICATE_ENTRY' });
      expect(auditLog).not.toHaveBeenCalled();
    });

    it('rejects a missing source_query with RegistryError code VALIDATION_ERROR', async () => {
      const { source_query: _omit, ...withoutQuery } = percentageDriftMetricFixture;

      await expect(service.register(withoutQuery)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('normalizes a missing thresholds field to an empty object', async () => {
      const { thresholds: _omit, ...withoutThresholds } = noThresholdMetricFixture;
      const created = toEntity(noThresholdMetricFixture);
      repository.create.mockResolvedValue(created);

      await service.register(withoutThresholds);

      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ thresholds: {} }));
    });

    it('accepts an explicit empty thresholds object identically to an omitted one', async () => {
      const created = toEntity(noThresholdMetricFixture);
      repository.create.mockResolvedValue(created);

      await service.register(noThresholdMetricFixture);

      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ thresholds: {} }));
    });

    it('validates the known threshold fields (comparison_operator must be one of the enum values)', async () => {
      await expect(
        service.register({ ...absoluteToleranceMetricFixture, thresholds: { comparison_operator: 'nope' } }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('preserves an unknown/extra threshold field via passthrough', async () => {
      const withExtra = { ...noThresholdMetricFixture, thresholds: { custom_field: 'anything' } };
      const created = toEntity(noThresholdMetricFixture, { thresholds: { custom_field: 'anything' } });
      repository.create.mockResolvedValue(created);

      await service.register(withExtra);

      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ thresholds: { custom_field: 'anything' } }));
    });

    it('stores a source_query containing special characters verbatim, without escaping', async () => {
      const created = toEntity(specialCharsSourceQueryMetricFixture);
      repository.create.mockResolvedValue(created);

      await service.register(specialCharsSourceQueryMetricFixture);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ source_query: specialCharsSourceQueryMetricFixture.source_query }),
      );
    });

    it('defaults description and dashboard_ref to null when omitted', async () => {
      const { description: _d, dashboard_ref: _r, ...minimal } = noThresholdMetricFixture;
      const created = toEntity(noThresholdMetricFixture, { description: null, dashboard_ref: null });
      repository.create.mockResolvedValue(created);

      await service.register(minimal);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: null, dashboard_ref: null }),
      );
    });

    it('writes an audit log entry with actor_id, action, resource_type, resource_id, and change_details', async () => {
      const created = toEntity(percentageDriftMetricFixture);
      repository.create.mockResolvedValue(created);

      await service.register(percentageDriftMetricFixture, 'actor-1');

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actor_id: 'actor-1',
          action: 'register',
          resource_type: 'metric',
          resource_id: created.id,
        }),
      );
    });
  });

  describe('get', () => {
    it('returns the metric when found', async () => {
      const entity = toEntity(percentageDriftMetricFixture);
      repository.findById.mockResolvedValue(entity);

      await expect(service.get(entity.id)).resolves.toEqual(entity);
    });

    it('throws RegistryError NOT_FOUND when the metric does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.get('missing-id')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('list', () => {
    it('defaults to page=1 limit=20 and translates to offset pagination', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 0, hasNext: false });

      const result = await service.list();

      expect(repository.findMany).toHaveBeenCalledWith(undefined, undefined, { kind: 'offset', offset: 0, limit: 20 });
      expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20 });
    });

    it('computes offset correctly for page > 1', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 12, hasNext: false });

      const result = await service.list({ page: 2, limit: 5 });

      expect(repository.findMany).toHaveBeenCalledWith(undefined, undefined, { kind: 'offset', offset: 5, limit: 5 });
      expect(result.page).toBe(2);
    });
  });

  describe('update', () => {
    it('merges a partial update (e.g. only thresholds) without nulling out other fields', async () => {
      const existing = toEntity(percentageDriftMetricFixture);
      const newThresholds = { percentage_tolerance: 10, comparison_operator: 'lte' as const };
      const updated = { ...existing, thresholds: newThresholds };
      repository.findById.mockResolvedValue(existing);
      repository.update.mockResolvedValue(updated);

      const result = await service.update(existing.id, { thresholds: newThresholds });

      expect(result.thresholds).toEqual(newThresholds);
      expect(repository.update).toHaveBeenCalledWith(existing.id, { thresholds: newThresholds });
    });

    it('rejects updates to non-existent metrics with RegistryError NOT_FOUND', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.update('missing-id', { description: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('rejects a name conflict with RegistryError DUPLICATE_ENTRY', async () => {
      const existing = toEntity(percentageDriftMetricFixture);
      repository.findById.mockResolvedValue(existing);
      repository.update.mockRejectedValue(new DuplicateKeyError('MetricRegistryEntry', 'name'));

      await expect(service.update(existing.id, { name: 'error_rate_pct' })).rejects.toMatchObject({
        code: 'DUPLICATE_ENTRY',
      });
    });

    it('maps a repository-level EntityNotFoundError to RegistryError NOT_FOUND', async () => {
      const existing = toEntity(percentageDriftMetricFixture);
      repository.findById.mockResolvedValue(existing);
      repository.update.mockRejectedValue(new EntityNotFoundError('MetricRegistryEntry', existing.id));

      await expect(service.update(existing.id, { description: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('writes an audit log entry with before/after change_details', async () => {
      const existing = toEntity(percentageDriftMetricFixture);
      const updated = { ...existing, description: 'Updated' };
      repository.findById.mockResolvedValue(existing);
      repository.update.mockResolvedValue(updated);

      await service.update(existing.id, { description: 'Updated' }, 'actor-2');

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actor_id: 'actor-2',
          action: 'update',
          resource_type: 'metric',
          resource_id: existing.id,
          change_details: { before: existing, after: { description: 'Updated' } },
        }),
      );
    });
  });

  describe('deregister', () => {
    it('performs a hard delete and writes an audit log entry', async () => {
      const existing = toEntity(percentageDriftMetricFixture);
      repository.findById.mockResolvedValue(existing);
      repository.delete.mockResolvedValue(undefined);

      await service.deregister(existing.id, 'actor-3');

      expect(repository.delete).toHaveBeenCalledWith(existing.id);
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'deregister', resource_type: 'metric', resource_id: existing.id }),
      );
    });

    it('rejects deregistering a non-existent metric with RegistryError NOT_FOUND', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.deregister('missing-id')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(repository.delete).not.toHaveBeenCalled();
    });
  });
});
