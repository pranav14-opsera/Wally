import type { z } from 'zod';

import { DuplicateKeyError, EntityNotFoundError, type IRepository } from '../adapters/data/index.js';
import { createToolSchema, toolQuerySchema, updateToolSchema } from './schemas/tool.schema.js';
import type { CreateToolSchema, ToolQuerySchema, UpdateToolSchema } from './schemas/tool.schema.js';
import type { ToolDefinition } from './types/tool.types.js';
import { RegistryError, type IAuditLogger, type PaginatedResult } from './types/registry.types.js';

const RESOURCE_TYPE = 'tool';

// z.ZodTypeAny (not a generic ZodType<T>) — schemas with `.default()`
// have a narrower output type than input type, which a single-param
// ZodType<T> can't express without also fixing the input/def type
// params; the cast on the return is safe since callers pass the exact
// schema whose parsed shape T describes.
function validate<T>(schema: z.ZodTypeAny, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new RegistryError('Tool definition failed validation', 'VALIDATION_ERROR', {
      issues: result.error.issues,
    });
  }
  return result.data as T;
}

/**
 * The pattern-setting registry service (WO-023) — Metric/Config/Spec
 * registries (WO-024/025/026) follow this class's shape exactly:
 * constructor-injected `IRepository<T>` + `IAuditLogger` (never a
 * concrete Prisma/Mongoose type), zod-validated inputs, `RegistryError`
 * for every failure mode, and an audit log entry on every mutation.
 */
export class ToolRegistryService {
  public constructor(
    private readonly repository: IRepository<ToolDefinition>,
    private readonly auditLogger: IAuditLogger,
  ) {}

  public async register(input: unknown, actorId: string | null = null): Promise<ToolDefinition> {
    const data = validate<CreateToolSchema>(createToolSchema, input);

    let created: ToolDefinition;
    try {
      created = await this.repository.create({
        ...data,
        description: data.description ?? null,
        credential_ref: data.credential_ref ?? null,
        health_status: 'unknown',
        last_health_check: null,
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

  public async get(id: string): Promise<ToolDefinition> {
    const tool = await this.repository.findById(id);
    if (!tool) {
      throw this.notFound(id);
    }
    return tool;
  }

  public async list(params: unknown = {}): Promise<PaginatedResult<ToolDefinition>> {
    const { page, limit } = validate<ToolQuerySchema>(toolQuerySchema, params);
    const offset = (page - 1) * limit;

    const result = await this.repository.findMany(undefined, undefined, { kind: 'offset', offset, limit });
    return { items: result.items, total: result.total, page, limit };
  }

  public async update(id: string, input: unknown, actorId: string | null = null): Promise<ToolDefinition> {
    const data = validate<UpdateToolSchema>(updateToolSchema, input);

    const existing = await this.repository.findById(id);
    if (!existing) {
      throw this.notFound(id);
    }

    let updated: ToolDefinition;
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

    // Hard delete per the WO's data-retention constraint — no soft
    // delete / is_deleted flag. Credential cleanup (credential_ref) is
    // explicitly the caller's responsibility, not this service's, per
    // the WO's edge-case list.
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
    return new RegistryError(`Tool not found: ${id}`, 'NOT_FOUND', { id });
  }

  private mapCreateOrUpdateError(error: unknown, name: string | undefined, id: string | undefined): Error {
    if (error instanceof DuplicateKeyError) {
      return new RegistryError(
        `A tool named "${name}" already exists`,
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
