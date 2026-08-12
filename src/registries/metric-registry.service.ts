import type { z } from 'zod';

import { DuplicateKeyError, EntityNotFoundError, type IRepository } from '../adapters/data/index.js';
import { createMetricSchema, metricQuerySchema, updateMetricSchema } from './schemas/metric.schema.js';
import type { CreateMetricSchema, MetricQuerySchema, UpdateMetricSchema } from './schemas/metric.schema.js';
import type { MetricDefinition } from './types/metric.types.js';
import { RegistryError, type IAuditLogger, type PaginatedResult } from './types/registry.types.js';

const RESOURCE_TYPE = 'metric';

function validate<T>(schema: z.ZodTypeAny, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new RegistryError('Metric definition failed validation', 'VALIDATION_ERROR', {
      issues: result.error.issues,
    });
  }
  return result.data as T;
}

/**
 * Follows ToolRegistryService's pattern exactly (WO-023, the
 * pattern-setter): constructor-injected `IRepository<T>` + `IAuditLogger`,
 * zod-validated inputs, `RegistryError` for every failure mode, and an
 * audit log entry on every mutation. `source_query` is stored verbatim —
 * this service never executes it; that's the Validation Agent's job.
 */
export class MetricRegistryService {
  public constructor(
    private readonly repository: IRepository<MetricDefinition>,
    private readonly auditLogger: IAuditLogger,
  ) {}

  public async register(input: unknown, actorId: string | null = null): Promise<MetricDefinition> {
    const data = validate<CreateMetricSchema>(createMetricSchema, input);

    let created: MetricDefinition;
    try {
      created = await this.repository.create({
        ...data,
        description: data.description ?? null,
        dashboard_ref: data.dashboard_ref ?? null,
      });
    } catch (error) {
      throw this.mapCreateOrUpdateError(error, data.name, undefined);
    }

    await this.auditLogger.log({
      actor_id: actorId,
      action: 'register',
      resource_type: RESOURCE_TYPE,
      resource_id: created.id,
      change_details: { after: data },
    });

    return created;
  }

  public async get(id: string): Promise<MetricDefinition> {
    const metric = await this.repository.findById(id);
    if (!metric) {
      throw this.notFound(id);
    }
    return metric;
  }

  public async list(params: unknown = {}): Promise<PaginatedResult<MetricDefinition>> {
    const { page, limit } = validate<MetricQuerySchema>(metricQuerySchema, params);
    const offset = (page - 1) * limit;

    const result = await this.repository.findMany(undefined, undefined, { kind: 'offset', offset, limit });
    return { items: result.items, total: result.total, page, limit };
  }

  public async update(id: string, input: unknown, actorId: string | null = null): Promise<MetricDefinition> {
    const data = validate<UpdateMetricSchema>(updateMetricSchema, input);

    const existing = await this.repository.findById(id);
    if (!existing) {
      throw this.notFound(id);
    }

    let updated: MetricDefinition;
    try {
      updated = await this.repository.update(id, data);
    } catch (error) {
      throw this.mapCreateOrUpdateError(error, data.name, id);
    }

    await this.auditLogger.log({
      actor_id: actorId,
      action: 'update',
      resource_type: RESOURCE_TYPE,
      resource_id: id,
      change_details: { before: existing, after: data },
    });

    return updated;
  }

  public async deregister(id: string, actorId: string | null = null): Promise<void> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw this.notFound(id);
    }

    // Hard delete — no soft delete / is_deleted flag, per the same
    // data-retention constraint ToolRegistryService follows.
    await this.repository.delete(id);

    await this.auditLogger.log({
      actor_id: actorId,
      action: 'deregister',
      resource_type: RESOURCE_TYPE,
      resource_id: id,
      change_details: { before: existing },
    });
  }

  private notFound(id: string): RegistryError {
    return new RegistryError(`Metric not found: ${id}`, 'NOT_FOUND', { id });
  }

  private mapCreateOrUpdateError(error: unknown, name: string | undefined, id: string | undefined): Error {
    if (error instanceof DuplicateKeyError) {
      return new RegistryError(
        `A metric named "${name}" already exists`,
        'DUPLICATE_ENTRY',
        id ? { id, name } : { name },
      );
    }
    if (error instanceof EntityNotFoundError) {
      return this.notFound(id ?? 'unknown');
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
