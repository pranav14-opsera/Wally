import type { z } from 'zod';

import { DuplicateKeyError, type FilterOptions, type IRepository, type SortOptions } from '../adapters/data/index.js';
import { createSpecSchema, specQuerySchema } from './schemas/spec.schema.js';
import type { CreateSpecSchema, SpecQuerySchema } from './schemas/spec.schema.js';
import type { CreateSpecInput, ISpecRegistryService, SpecEntry } from './types/spec.types.js';
import { RegistryError, type IAuditLogger, type PaginatedResult } from './types/registry.types.js';
import { computeChecksum } from './utils/checksum.js';

const RESOURCE_TYPE = 'spec';

function validate<T>(schema: z.ZodTypeAny, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new RegistryError('Spec entry failed validation', 'VALIDATION_ERROR', { issues: result.error.issues });
  }
  return result.data as T;
}

/**
 * Append-only registry (WO-026) — deliberately implements the narrower
 * `ISpecRegistryService`, not the four-method register/get/list/update/
 * deregister shape the other three registries follow. Spec versions are
 * immutable once stored: integrity depends on it (the API Lifecycle
 * Agent's semantic diff compares two stored versions, which must never
 * change out from under it), so there is no update() or deregister() —
 * not "not implemented", genuinely not exposed at the type level.
 */
export class SpecRegistryService implements ISpecRegistryService {
  public constructor(
    private readonly repository: IRepository<SpecEntry>,
    private readonly auditLogger: IAuditLogger,
  ) {}

  public async register(input: unknown, actorId: string | null = null): Promise<SpecEntry> {
    const data = validate<CreateSpecSchema>(createSpecSchema, input);

    let checksum: string;
    try {
      checksum = computeChecksum(data.spec_content);
    } catch (error) {
      throw new RegistryError(
        `spec_content for "${data.api_name}"@"${data.version}" could not be serialized — it likely contains a ` +
          `circular reference (${error instanceof Error ? error.message : String(error)})`,
        'VALIDATION_ERROR',
        { api_name: data.api_name, version: data.version },
      );
    }

    const toCreate: Omit<SpecEntry, 'id' | 'created_at' | 'updated_at'> = {
      ...(data as CreateSpecInput),
      checksum,
    };

    let created: SpecEntry;
    try {
      created = await this.repository.create(toCreate);
    } catch (error) {
      if (error instanceof DuplicateKeyError) {
        throw new RegistryError(
          `Spec "${data.api_name}" version "${data.version}" already exists — spec versions are immutable, ` +
            'register a new version instead',
          'DUPLICATE_ENTRY',
          { api_name: data.api_name, version: data.version },
        );
      }
      throw error;
    }

    await this.auditLogger.log({
      actor_id: actorId,
      action: 'spec_registered',
      resource_type: RESOURCE_TYPE,
      resource_id: created.id,
      change_details: { api_name: data.api_name, version: data.version, checksum },
    });

    return created;
  }

  public async get(id: string): Promise<SpecEntry> {
    const spec = await this.repository.findById(id);
    if (!spec) {
      throw this.notFound(id);
    }
    return spec;
  }

  public async list(params: unknown = {}): Promise<PaginatedResult<SpecEntry>> {
    const { page, limit, api_name } = validate<SpecQuerySchema>(specQuerySchema, params);
    const offset = (page - 1) * limit;

    const filters = api_name ? ({ api_name: { operator: 'eq', value: api_name } } as FilterOptions<SpecEntry>) : undefined;
    const sort = { created_at: 'desc' } as SortOptions<SpecEntry>;

    const result = await this.repository.findMany(filters, sort, { kind: 'offset', offset, limit });
    return { items: result.items, total: result.total, page, limit };
  }

  public async getLatestByApiName(apiName: string): Promise<SpecEntry> {
    const result = await this.repository.findMany(
      { api_name: { operator: 'eq', value: apiName } } as FilterOptions<SpecEntry>,
      { created_at: 'desc' } as SortOptions<SpecEntry>,
      { kind: 'offset', offset: 0, limit: 1 },
    );
    const latest = result.items[0];
    if (!latest) {
      throw new RegistryError(`No spec versions found for api_name: ${apiName}`, 'NOT_FOUND', { api_name: apiName });
    }
    return latest;
  }

  private notFound(id: string): RegistryError {
    return new RegistryError(`Spec not found: ${id}`, 'NOT_FOUND', { id });
  }
}
