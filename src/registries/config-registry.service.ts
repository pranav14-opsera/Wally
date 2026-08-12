import type { z } from 'zod';

import { DuplicateKeyError, type FilterOptions, type IRepository } from '../adapters/data/index.js';
import { createConfigSchema, configQuerySchema, updateConfigSchema, valueMatchesDataType } from './schemas/config.schema.js';
import type { CreateConfigSchema, ConfigQuerySchema, UpdateConfigSchema } from './schemas/config.schema.js';
import type { ConfigDataType, ConfigEntry } from './types/config.types.js';
import { RegistryError, type IAuditLogger, type PaginatedResult } from './types/registry.types.js';

const RESOURCE_TYPE = 'config';

function validate<T>(schema: z.ZodTypeAny, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new RegistryError('Config entry failed validation', 'VALIDATION_ERROR', { issues: result.error.issues });
  }
  return result.data as T;
}

/**
 * Follows ToolRegistryService's pattern (WO-023) with one structural
 * difference: every lookup is by `key` (the business identifier), not
 * `id` — `IRepository<T>` only exposes id-based findById/update/delete,
 * so this service resolves key -> entity via `findMany` with an `eq`
 * filter before delegating to the id-based repository methods.
 *
 * `data_type` is immutable once a config entry is created — update()
 * only accepts value/description and re-validates the new value against
 * the *existing* entry's data_type (there is no data_type in the update
 * input to validate against).
 */
export class ConfigRegistryService {
  public constructor(
    private readonly repository: IRepository<ConfigEntry>,
    private readonly auditLogger: IAuditLogger,
  ) {}

  public async register(input: unknown, actorId: string | null = null): Promise<ConfigEntry> {
    const data = validate<CreateConfigSchema>(createConfigSchema, input);

    let created: ConfigEntry;
    try {
      created = await this.repository.create({
        ...data,
        description: data.description ?? null,
        category: data.category ?? null,
      });
    } catch (error) {
      throw this.mapCreateError(error, data.key);
    }

    await this.auditLogger.log({
      actor_id: actorId,
      action: 'register',
      resource_type: RESOURCE_TYPE,
      resource_id: data.key,
      change_details: { after: data },
    });

    return created;
  }

  public async get(key: string): Promise<ConfigEntry> {
    const entry = await this.findByKey(key);
    if (!entry) {
      throw this.notFound(key);
    }
    return entry;
  }

  public async list(params: unknown = {}): Promise<PaginatedResult<ConfigEntry>> {
    const { page, limit, category } = validate<ConfigQuerySchema>(configQuerySchema, params);
    const offset = (page - 1) * limit;

    const filters = category
      ? ({ category: { operator: 'eq', value: category } } as FilterOptions<ConfigEntry>)
      : undefined;

    const result = await this.repository.findMany(filters, undefined, { kind: 'offset', offset, limit });
    return { items: result.items, total: result.total, page, limit };
  }

  public async update(key: string, input: unknown, actorId: string | null = null): Promise<ConfigEntry> {
    const data = validate<UpdateConfigSchema>(updateConfigSchema, input);

    const existing = await this.findByKey(key);
    if (!existing) {
      throw this.notFound(key);
    }

    if (data.value !== undefined && !valueMatchesDataType(data.value, existing.data_type as ConfigDataType)) {
      throw new RegistryError(
        `value "${data.value}" is not valid for data_type "${existing.data_type}" (data_type is immutable — the ` +
          'declared type of an existing config entry cannot change)',
        'VALIDATION_ERROR',
        { key, data_type: existing.data_type, value: data.value },
      );
    }

    const updated = await this.repository.update(existing.id, data);

    await this.auditLogger.log({
      actor_id: actorId,
      action: 'update',
      resource_type: RESOURCE_TYPE,
      resource_id: key,
      change_details: {
        old_value: existing.value,
        new_value: data.value ?? existing.value,
        description: data.description,
      },
    });

    return updated;
  }

  public async deregister(key: string, actorId: string | null = null): Promise<void> {
    const existing = await this.findByKey(key);
    if (!existing) {
      throw this.notFound(key);
    }

    await this.repository.delete(existing.id);

    await this.auditLogger.log({
      actor_id: actorId,
      action: 'deregister',
      resource_type: RESOURCE_TYPE,
      resource_id: key,
      change_details: { before: existing },
    });
  }

  /** SQL/NoSQL injection is structurally impossible here — `key` only ever reaches the repository as a filter *value*, never concatenated into a query string; IRepository's Prisma/Mongoose implementations parameterize every value. */
  private async findByKey(key: string): Promise<ConfigEntry | null> {
    const result = await this.repository.findMany(
      { key: { operator: 'eq', value: key } } as FilterOptions<ConfigEntry>,
      undefined,
      { kind: 'offset', offset: 0, limit: 1 },
    );
    return result.items[0] ?? null;
  }

  private notFound(key: string): RegistryError {
    return new RegistryError(`Config entry not found: ${key}`, 'NOT_FOUND', { key });
  }

  private mapCreateError(error: unknown, key: string): Error {
    if (error instanceof DuplicateKeyError) {
      return new RegistryError(`A config entry with key "${key}" already exists`, 'DUPLICATE_ENTRY', { key });
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
