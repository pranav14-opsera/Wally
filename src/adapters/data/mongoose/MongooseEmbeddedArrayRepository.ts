import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

import type { ClientSession, Model } from 'mongoose';
import type { Logger } from 'pino';

import { DataAdapterError, EntityNotFoundError, TransactionError, ValidationError } from '../errors.js';
import type { IRepository } from '../interfaces/IRepository.js';
import { applyPagination, applySort, matchesFilter } from '../in-memory-query.js';
import type { BaseEntity, FilterOptions, PaginatedResult, PaginationOptions, SortOptions, TransactionContext } from '../types.js';
import { isMongooseTransactionError, mapMongooseError } from './error-mapper.js';

/**
 * Shared implementation for repositories that operate on an embedded
 * array field of a *different* Mongoose model (JobStep/DriftEvent
 * embedded on AgentJob — see AgentJob.schema.ts, WO-010) while still
 * satisfying `IRepository<TEmbedded>` as if that array were its own
 * standalone collection. MongoDB has no server-side way to query,
 * filter, sort, or paginate *within* one document's array independent
 * of the parent document — every operation here either targets the
 * parent by its own `_id` (create/update/delete, via `$push`/positional
 * `$`/`$pull`) or materializes the whole array and does filter/sort/
 * pagination in memory (findMany/count), reusing the exact same
 * semantics `StubRepository` uses (`in-memory-query.ts`) so both engines
 * behave identically per REQ-002.
 *
 * `findMany`/`count` require an `eq` filter on `job_id` — there is no
 * way to query "all JobSteps across every AgentJob" without either an
 * expensive `$unwind` aggregation across the whole collection or
 * fetching every AgentJob document, neither of which this WO
 * implements; a clear `ValidationError` is thrown instead of silently
 * returning a wrong/partial result.
 *
 * `maxArraySize` guards MongoDB's 16MB per-document limit: the schema's
 * own array-length `validate` (AgentJob.schema.ts) does NOT fire for
 * `$push` — Mongoose update validators only validate the pushed
 * element(s), not whole-array custom validators, since they never
 * reconstitute the full array — so `create()` checks the current length
 * itself before pushing and fails fast with a descriptive
 * `ValidationError` instead of letting the driver reject an oversized
 * document. `performanceWarnThreshold` (default: half of
 * `maxArraySize`) makes `findMany` log a warning once an embedded
 * array grows large enough that its in-memory filter/sort/pagination
 * (this class has no other option — see class doc above) becomes a
 * real cost.
 */
export abstract class MongooseEmbeddedArrayRepository<TEmbedded extends BaseEntity> implements IRepository<TEmbedded> {
  private readonly sessionStorage = new AsyncLocalStorage<ClientSession>();
  private readonly performanceWarnThreshold: number;

  protected constructor(
    private readonly parentModel: Model<Record<string, unknown>>,
    private readonly arrayField: string,
    protected readonly entityName: string,
    protected readonly logger: Logger,
    private readonly mapEmbedded: (raw: Record<string, unknown>, parentId: string) => TEmbedded,
    private readonly maxArraySize: number,
    performanceWarnThreshold?: number,
  ) {
    this.performanceWarnThreshold = performanceWarnThreshold ?? Math.floor(maxArraySize / 2);
  }

  protected get currentSession(): ClientSession | undefined {
    return this.sessionStorage.getStore();
  }

  private extractParentId(filters: FilterOptions<TEmbedded> | undefined, operation: string): string {
    const condition = (filters as unknown as Record<string, { operator: string; value: unknown }> | undefined)?.[
      'job_id'
    ];
    if (!condition || condition.operator !== 'eq' || typeof condition.value !== 'string') {
      throw new ValidationError(
        `${this.entityName}.${operation} requires an eq filter on job_id — ${this.entityName} is embedded ` +
          `within its parent AgentJob document, so a query across all ${this.entityName}s regardless of job ` +
          `is not supported.`,
      );
    }
    return condition.value;
  }

  private extractArray(parent: Record<string, unknown> | null): Array<Record<string, unknown>> {
    return parent ? ((parent[this.arrayField] ?? []) as Array<Record<string, unknown>>) : [];
  }

  public async findById(id: string): Promise<TEmbedded | null> {
    try {
      const parent = await this.parentModel
        .findOne({ [`${this.arrayField}._id`]: id })
        .session(this.currentSession ?? null)
        .lean();
      if (!parent) {
        return null;
      }
      const match = this.extractArray(parent as Record<string, unknown>).find((item) => item._id === id);
      return match ? this.mapEmbedded(match, (parent as Record<string, unknown>)._id as string) : null;
    } catch (error) {
      throw mapMongooseError(error, { entityName: this.entityName, operation: 'findById' });
    }
  }

  public async findMany(
    filters?: FilterOptions<TEmbedded>,
    sort?: SortOptions<TEmbedded>,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<TEmbedded>> {
    try {
      const parentId = this.extractParentId(filters, 'findMany');
      const parent = await this.parentModel.findById(parentId).session(this.currentSession ?? null).lean();
      const rawArray = this.extractArray(parent as Record<string, unknown> | null);
      if (rawArray.length > this.performanceWarnThreshold) {
        this.logger.warn(
          { entityName: this.entityName, parentId, arraySize: rawArray.length, threshold: this.performanceWarnThreshold },
          `${this.entityName}.findMany: embedded ${this.arrayField} array on AgentJob ${parentId} has ${rawArray.length} ` +
            `items, above the ${this.performanceWarnThreshold} performance warning threshold — filter/sort/pagination ` +
            'run in-memory on the full array for embedded documents.',
        );
      }
      let items = rawArray.map((raw) => this.mapEmbedded(raw, parentId));

      const remainingFilters = { ...filters } as Record<string, unknown>;
      delete remainingFilters.job_id;
      if (Object.keys(remainingFilters).length > 0) {
        items = items.filter((item) => matchesFilter(item, remainingFilters as FilterOptions<TEmbedded>));
      }

      items = applySort(items, sort);
      const total = items.length;
      const { page, hasNext, nextCursor } = applyPagination(items, pagination);
      return { items: page, total, hasNext, ...(nextCursor ? { nextCursor } : {}) };
    } catch (error) {
      throw mapMongooseError(error, { entityName: this.entityName, operation: 'findMany' });
    }
  }

  public async create(data: Omit<TEmbedded, 'id' | 'created_at' | 'updated_at'>): Promise<TEmbedded> {
    try {
      const jobId = (data as unknown as { job_id?: string }).job_id;
      if (!jobId) {
        throw new ValidationError(`${this.entityName}.create requires job_id (the parent AgentJob's id)`);
      }

      const parent = await this.parentModel
        .findById(jobId)
        .select(this.arrayField)
        .session(this.currentSession ?? null)
        .lean();
      if (!parent) {
        throw new EntityNotFoundError('AgentJob', jobId);
      }
      const currentSize = this.extractArray(parent as Record<string, unknown>).length;
      if (currentSize >= this.maxArraySize) {
        throw new ValidationError(
          `Cannot add another ${this.entityName} to AgentJob ${jobId}: ${this.arrayField} already holds ` +
            `${currentSize} embedded items, at the defensive cap of ${this.maxArraySize} (MongoDB's 16MB ` +
            'per-document limit). This workflow likely needs re-architecting, e.g. splitting into sub-jobs.',
        );
      }

      const { job_id: _jobId, ...embeddedFields } = data as unknown as Record<string, unknown>;
      const now = new Date();
      const newItem = { _id: randomUUID(), ...embeddedFields, created_at: now, updated_at: now };

      const result = await this.parentModel.updateOne(
        { _id: jobId },
        { $push: { [this.arrayField]: newItem } },
        { session: this.currentSession },
      );
      if (result.matchedCount === 0) {
        throw new EntityNotFoundError('AgentJob', jobId);
      }
      return this.mapEmbedded(newItem, jobId);
    } catch (error) {
      throw mapMongooseError(error, { entityName: this.entityName, operation: 'create' });
    }
  }

  public async createMany(data: Array<Omit<TEmbedded, 'id' | 'created_at' | 'updated_at'>>): Promise<TEmbedded[]> {
    const created: TEmbedded[] = [];
    for (const item of data) {
      created.push(await this.create(item));
    }
    return created;
  }

  /**
   * MongoDB applies `$push` atomically, so concurrent `create()` calls
   * against the same parent array never lose an item. The positional
   * `$` operator here is not the same guarantee: two concurrent
   * `update()` calls racing on the *same* embedded element both match
   * on the array position at their respective query time, so the
   * later `$set` wins outright rather than merging — last-write-wins,
   * not a detected conflict. Acceptable for this WO's scope; callers
   * needing stronger guarantees should serialize updates to a given
   * element themselves.
   */
  public async update(id: string, data: Partial<Omit<TEmbedded, 'id' | 'created_at' | 'updated_at'>>): Promise<TEmbedded> {
    try {
      const parent = await this.parentModel
        .findOne({ [`${this.arrayField}._id`]: id })
        .session(this.currentSession ?? null)
        .lean();
      if (!parent) {
        throw new EntityNotFoundError(this.entityName, id);
      }
      const parentId = (parent as Record<string, unknown>)._id as string;

      const setFields: Record<string, unknown> = { [`${this.arrayField}.$.updated_at`]: new Date() };
      for (const [field, value] of Object.entries(data)) {
        setFields[`${this.arrayField}.$.${field}`] = value;
      }

      await this.parentModel.updateOne(
        { [`${this.arrayField}._id`]: id },
        { $set: setFields },
        { session: this.currentSession, runValidators: true },
      );

      const updatedParent = await this.parentModel
        .findById(parentId)
        .session(this.currentSession ?? null)
        .lean();
      const updated = this.extractArray(updatedParent as Record<string, unknown> | null).find(
        (item) => item._id === id,
      );
      if (!updated) {
        throw new EntityNotFoundError(this.entityName, id);
      }
      return this.mapEmbedded(updated, parentId);
    } catch (error) {
      throw mapMongooseError(error, { entityName: this.entityName, operation: 'update' });
    }
  }

  public async delete(id: string): Promise<void> {
    try {
      const parent = await this.parentModel
        .findOne({ [`${this.arrayField}._id`]: id })
        .session(this.currentSession ?? null)
        .lean();
      if (!parent) {
        throw new EntityNotFoundError(this.entityName, id);
      }
      await this.parentModel.updateOne(
        { _id: (parent as Record<string, unknown>)._id },
        { $pull: { [this.arrayField]: { _id: id } } },
        { session: this.currentSession },
      );
    } catch (error) {
      throw mapMongooseError(error, { entityName: this.entityName, operation: 'delete' });
    }
  }

  public async count(filters?: FilterOptions<TEmbedded>): Promise<number> {
    try {
      const parentId = this.extractParentId(filters, 'count');
      const parent = await this.parentModel.findById(parentId).session(this.currentSession ?? null).lean();
      return this.extractArray(parent as Record<string, unknown> | null).length;
    } catch (error) {
      throw mapMongooseError(error, { entityName: this.entityName, operation: 'count' });
    }
  }

  public async transaction<R>(fn: (ctx: TransactionContext) => Promise<R>): Promise<R> {
    if (this.sessionStorage.getStore()) {
      throw new TransactionError(
        `Nested transaction attempted on ${this.entityName} repository — this repository does not support nested transactions.`,
      );
    }

    // See the identical comment in MongooseRepository.ts's transaction() —
    // must use the parent model's own connection, not the global
    // `mongoose.startSession()`.
    const session = await this.parentModel.db.startSession();
    try {
      let result: R | undefined;
      await session.withTransaction(async () => {
        result = await this.sessionStorage.run(session, () => fn({ id: randomUUID() }));
      });
      return result as R;
    } catch (error) {
      if (error instanceof DataAdapterError || isMongooseTransactionError(error)) {
        throw mapMongooseError(error, { entityName: this.entityName, operation: 'transaction' });
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }
}
