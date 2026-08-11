import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

import type { ClientSession, Model } from 'mongoose';
import type { Logger } from 'pino';

import { DataAdapterError, EntityNotFoundError, TransactionError } from '../errors.js';
import type { IRepository } from '../interfaces/IRepository.js';
import type { BaseEntity, FilterOptions, PaginatedResult, PaginationOptions, SortOptions } from '../types.js';
import type { TransactionContext } from '../types.js';
import { isMongooseTransactionError, mapMongooseError } from './error-mapper.js';
import { toDomainEntities, toDomainEntity } from './mappers.js';
import { buildPaginationPlan, buildQuery, buildSort, primarySortField } from './query-builder.js';

/**
 * Generic `IRepository<T>` implementation for a standalone MongoDB
 * collection (users, tool_registry, metric_registry, config_registry,
 * spec_registry, audit_logs, load_test_results) backed by a Mongoose
 * `Model`. Does *not* handle AgentJob's embedded `job_steps`/
 * `drift_events` — see MongooseAgentJobRepository, MongooseJobStepRepository,
 * and MongooseDriftEventRepository for those.
 *
 * `transaction()` scopes the active `ClientSession` via `AsyncLocalStorage`
 * (not a mutable instance field) — identical rationale to
 * `PrismaRepository` (WO-009): a mutable field would let one request's
 * transaction leak into a concurrent, unrelated call on the same
 * singleton repository instance.
 */
export class MongooseRepository<T extends BaseEntity> implements IRepository<T> {
  private readonly sessionStorage = new AsyncLocalStorage<ClientSession>();

  public constructor(
    protected readonly model: Model<Record<string, unknown>>,
    protected readonly entityName: string,
    protected readonly logger: Logger,
  ) {}

  protected get currentSession(): ClientSession | undefined {
    return this.sessionStorage.getStore();
  }

  public async findById(id: string): Promise<T | null> {
    try {
      const doc = await this.model.findById(id).session(this.currentSession ?? null).lean();
      return doc ? toDomainEntity<T>(doc as Record<string, unknown>) : null;
    } catch (error) {
      throw mapMongooseError(error, { entityName: this.entityName, operation: 'findById' });
    }
  }

  public async findMany(
    filters?: FilterOptions<T>,
    sort?: SortOptions<T>,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<T>> {
    try {
      const baseQuery = buildQuery(filters);
      const mongoSort = buildSort(sort);

      let cursorValue: unknown;
      const cursorId = pagination?.kind === 'cursor' ? pagination.cursor : undefined;
      if (cursorId) {
        const { field } = primarySortField(mongoSort);
        const cursorDoc = await this.model.findById(cursorId).session(this.currentSession ?? null).lean();
        if (cursorDoc) {
          cursorValue = (cursorDoc as Record<string, unknown>)[field === '_id' ? '_id' : field];
        }
      }

      const plan = buildPaginationPlan(pagination, mongoSort, cursorValue, cursorId);
      const query = plan.cursorQuery ? { $and: [baseQuery, plan.cursorQuery] } : baseQuery;

      const [docs, total] = await Promise.all([
        this.model
          .find(query)
          .session(this.currentSession ?? null)
          .sort(mongoSort)
          .skip(plan.skip ?? 0)
          .limit(plan.limit)
          .lean(),
        this.model.countDocuments(baseQuery).session(this.currentSession ?? null),
      ]);

      if (pagination?.kind === 'cursor') {
        const hasNext = docs.length > pagination.limit;
        const page = hasNext ? docs.slice(0, pagination.limit) : docs;
        const items = toDomainEntities<T>(page as Array<Record<string, unknown>>);
        const nextCursor = hasNext ? items[items.length - 1]?.id : undefined;
        return { items, total, hasNext, ...(nextCursor ? { nextCursor } : {}) };
      }

      const items = toDomainEntities<T>(docs as Array<Record<string, unknown>>);
      const hasNext = pagination ? pagination.offset + items.length < total : false;
      return { items, total, hasNext };
    } catch (error) {
      throw mapMongooseError(error, { entityName: this.entityName, operation: 'findMany' });
    }
  }

  public async create(data: Omit<T, 'id' | 'created_at' | 'updated_at'>): Promise<T> {
    try {
      const doc = new this.model(data);
      await doc.save({ session: this.currentSession });
      return toDomainEntity<T>(doc.toObject({ virtuals: false, versionKey: true }) as Record<string, unknown>);
    } catch (error) {
      throw mapMongooseError(error, { entityName: this.entityName, operation: 'create' });
    }
  }

  public async createMany(data: Array<Omit<T, 'id' | 'created_at' | 'updated_at'>>): Promise<T[]> {
    try {
      // ordered: false — one bad document doesn't block the rest from
      // being inserted, matching the AC's "partial success handling".
      const docs = await this.model.insertMany(data, { session: this.currentSession, ordered: false });
      return docs.map((doc) => toDomainEntity<T>(doc.toObject({ virtuals: false, versionKey: true }) as Record<string, unknown>));
    } catch (error) {
      throw mapMongooseError(error, { entityName: this.entityName, operation: 'createMany' });
    }
  }

  public async update(id: string, data: Partial<Omit<T, 'id' | 'created_at' | 'updated_at'>>): Promise<T> {
    try {
      const doc = await this.model
        .findByIdAndUpdate(id, data, { new: true, runValidators: true, session: this.currentSession })
        .lean();
      if (!doc) {
        throw new EntityNotFoundError(this.entityName, id);
      }
      return toDomainEntity<T>(doc as Record<string, unknown>);
    } catch (error) {
      throw mapMongooseError(error, { entityName: this.entityName, operation: 'update' });
    }
  }

  public async delete(id: string): Promise<void> {
    try {
      const doc = await this.model.findByIdAndDelete(id, { session: this.currentSession }).lean();
      if (!doc) {
        throw new EntityNotFoundError(this.entityName, id);
      }
    } catch (error) {
      throw mapMongooseError(error, { entityName: this.entityName, operation: 'delete' });
    }
  }

  public async count(filters?: FilterOptions<T>): Promise<number> {
    try {
      return await this.model.countDocuments(buildQuery(filters)).session(this.currentSession ?? null);
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

    // Started on this model's own connection (`model.db`), not the
    // global `mongoose.startSession()` — this adapter uses a dedicated
    // `createConnection()` (WO-010's mongoose-client.ts), never the
    // unconnected global default, so a session from the global function
    // would belong to the wrong (disconnected) connection entirely.
    const session = await this.model.db.startSession();
    try {
      // `session.withTransaction()`'s own return value is a raw command
      // response, not the callback's result (see mongodb driver's own
      // doc comment on the method) — the result must be captured via an
      // outer-scope variable instead.
      let result: R | undefined;
      await session.withTransaction(async () => {
        result = await this.sessionStorage.run(session, () => fn({ id: randomUUID() }));
      });
      return result as R;
    } catch (error) {
      // Only normalize genuine Mongoose/MongoDB transaction failures —
      // an arbitrary error `fn` threw to signal its own rollback must
      // propagate unchanged, matching PrismaRepository's identical
      // rationale (WO-009) so callers can still catch their own error
      // types after a rolled-back transaction.
      if (error instanceof DataAdapterError || isMongooseTransactionError(error)) {
        throw mapMongooseError(error, { entityName: this.entityName, operation: 'transaction' });
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }
}
