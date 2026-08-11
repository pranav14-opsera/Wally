import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

import type { Logger } from 'pino';

import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import { DataAdapterError, TransactionError } from '../errors.js';
import type { IRepository } from '../interfaces/IRepository.js';
import type { BaseEntity, FilterOptions, PaginatedResult, PaginationOptions, SortOptions, TransactionContext } from '../types.js';
import { isPrismaDriverError, mapPrismaError } from './error-mapper.js';
import { toDomainEntity } from './mappers.js';
import { buildOrderBy, buildPaginationArgs, buildWhere } from './query-builder.js';

/**
 * A structural subset of every Prisma model delegate's shape (`findUnique`,
 * `findMany`, `count`, `create`, `createManyAndReturn`, `update`, `delete`)
 * — narrower than Prisma's own generated per-model delegate types, which
 * use conditional generics keyed to each model's exact field set and
 * can't be threaded through a single class generic over `T extends
 * BaseEntity` without either ten near-identical non-generic repository
 * classes or unsound `any`. Every model delegate genuinely has this shape
 * at runtime; concrete repositories bridge from Prisma's fully-typed
 * delegate to this one with a single documented cast where they're
 * constructed (see `getDelegate` in PrismaAgentJobRepository.ts and the
 * factory that will wire the other nine in a later WO).
 */
export interface PrismaModelDelegate<TModel> {
  findUnique(args: { where: { id: string } }): Promise<TModel | null>;
  findMany(args: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>;
    skip?: number;
    take?: number;
    cursor?: { id: string };
  }): Promise<TModel[]>;
  count(args?: { where?: Record<string, unknown> }): Promise<number>;
  create(args: { data: Record<string, unknown> }): Promise<TModel>;
  createManyAndReturn(args: { data: Array<Record<string, unknown>> }): Promise<TModel[]>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<TModel>;
  delete(args: { where: { id: string } }): Promise<TModel>;
}

// Deliberately more generous than Prisma's own defaults (maxWait: 2s,
// timeout: 5s) — appropriate for a job-orchestration platform where a
// transaction may span several related writes, not just a single
// statement. `IRepository.transaction<R>` (WO-007) takes no options
// parameter, so these can't be made caller-configurable per the AC's
// literal wording without a WO-007 interface change out of this WO's
// scope; every call uses these same values.
const TRANSACTION_MAX_WAIT_MS = 5_000;
const TRANSACTION_TIMEOUT_MS = 15_000;

/** Resolves this repository's model delegate off either the base client or a transaction client — same shape either way. */
export type DelegateResolver<TModel> = (
  client: PrismaClient | Prisma.TransactionClient,
) => PrismaModelDelegate<TModel>;

/**
 * Generic `IRepository<T>` implementation backed by a single Prisma
 * model delegate. `transaction()` scopes the client it operates through
 * via `AsyncLocalStorage` (not a mutable instance field) so concurrent,
 * unrelated calls on the same repository instance — the normal situation
 * for a singleton repository serving concurrent requests — can never
 * observe or corrupt each other's transaction state; a mutable-field
 * swap would have exactly that race.
 *
 * Transactions are scoped to a single repository instance, matching
 * `StubRepository` and `IRepository.transaction`'s own contract — calling
 * a *different* repository instance's methods from within `fn` does not
 * join this transaction (the interface has no mechanism for cross-
 * repository transactions; that would require a WO-007 interface change
 * out of this WO's scope).
 */
export class PrismaRepository<T extends BaseEntity> implements IRepository<T> {
  // Stores the *client* currently in scope (the base client, or a $transaction
  // callback's `tx`), not just this repository's own delegate — so subclasses
  // building their own richer queries (e.g. `include`-based composite reads
  // that this generic base class's narrow delegate can't express) can resolve
  // the same transaction-correct client via `currentClient` below, and
  // participate in the same transaction when called from within `fn`.
  private readonly transactionClient = new AsyncLocalStorage<PrismaClient | Prisma.TransactionClient>();

  public constructor(
    protected readonly prisma: PrismaClient,
    private readonly getDelegate: DelegateResolver<T>,
    protected readonly entityName: string,
    protected readonly logger: Logger,
  ) {}

  /** The client transaction()-scoped code should issue queries through — the base client outside a transaction, `tx` inside one. */
  protected get currentClient(): PrismaClient | Prisma.TransactionClient {
    return this.transactionClient.getStore() ?? this.prisma;
  }

  private get delegate(): PrismaModelDelegate<T> {
    return this.getDelegate(this.currentClient);
  }

  public async findById(id: string): Promise<T | null> {
    try {
      const record = await this.delegate.findUnique({ where: { id } });
      return record ? toDomainEntity<T>(record) : null;
    } catch (error) {
      throw mapPrismaError(error, { entityName: this.entityName, operation: 'findById', id });
    }
  }

  public async findMany(
    filters?: FilterOptions<T>,
    sort?: SortOptions<T>,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<T>> {
    try {
      const where = buildWhere(filters);
      const orderBy = buildOrderBy(sort);
      const { skip, take, cursor } = buildPaginationArgs(pagination);

      const [records, total] = await Promise.all([
        this.delegate.findMany({ where, orderBy, skip, take, cursor }),
        this.delegate.count({ where }),
      ]);

      if (pagination?.kind === 'cursor') {
        // over-fetched by one (see buildPaginationArgs) — its presence
        // is the "is there a next page" signal, then it's trimmed off.
        const hasNext = records.length > pagination.limit;
        const page = hasNext ? records.slice(0, pagination.limit) : records;
        const items = page.map((record) => toDomainEntity<T>(record));
        const nextCursor = hasNext ? items[items.length - 1]?.id : undefined;
        return { items, total, hasNext, ...(nextCursor ? { nextCursor } : {}) };
      }

      const items = records.map((record) => toDomainEntity<T>(record));
      const hasNext = pagination ? pagination.offset + items.length < total : false;
      return { items, total, hasNext };
    } catch (error) {
      throw mapPrismaError(error, { entityName: this.entityName, operation: 'findMany' });
    }
  }

  public async create(data: Omit<T, 'id' | 'created_at' | 'updated_at'>): Promise<T> {
    try {
      const record = await this.delegate.create({ data: data as Record<string, unknown> });
      return toDomainEntity<T>(record);
    } catch (error) {
      throw mapPrismaError(error, { entityName: this.entityName, operation: 'create' });
    }
  }

  public async createMany(data: Array<Omit<T, 'id' | 'created_at' | 'updated_at'>>): Promise<T[]> {
    try {
      const records = await this.delegate.createManyAndReturn({ data: data as Array<Record<string, unknown>> });
      return records.map((record) => toDomainEntity<T>(record));
    } catch (error) {
      throw mapPrismaError(error, { entityName: this.entityName, operation: 'createMany' });
    }
  }

  public async update(id: string, data: Partial<Omit<T, 'id' | 'created_at' | 'updated_at'>>): Promise<T> {
    try {
      const record = await this.delegate.update({ where: { id }, data: data as Record<string, unknown> });
      return toDomainEntity<T>(record);
    } catch (error) {
      throw mapPrismaError(error, { entityName: this.entityName, operation: 'update', id });
    }
  }

  public async delete(id: string): Promise<void> {
    try {
      await this.delegate.delete({ where: { id } });
    } catch (error) {
      throw mapPrismaError(error, { entityName: this.entityName, operation: 'delete', id });
    }
  }

  public async count(filters?: FilterOptions<T>): Promise<number> {
    try {
      return await this.delegate.count({ where: buildWhere(filters) });
    } catch (error) {
      throw mapPrismaError(error, { entityName: this.entityName, operation: 'count' });
    }
  }

  public async transaction<R>(fn: (ctx: TransactionContext) => Promise<R>): Promise<R> {
    if (this.transactionClient.getStore()) {
      throw new TransactionError(
        `Nested transaction attempted on ${this.entityName} repository — this repository (and StubRepository) does not support nested transactions.`,
      );
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          return this.transactionClient.run(tx, () => fn({ id: randomUUID() }));
        },
        { maxWait: TRANSACTION_MAX_WAIT_MS, timeout: TRANSACTION_TIMEOUT_MS },
      );
    } catch (error) {
      // Only normalize genuine Prisma/driver failures — an arbitrary
      // error `fn` threw to signal its own rollback (unrelated to
      // Prisma) must propagate unchanged, matching Prisma's own
      // `$transaction` contract, so callers can still catch their own
      // error types.
      if (error instanceof DataAdapterError || isPrismaDriverError(error)) {
        throw mapPrismaError(error, { entityName: this.entityName, operation: 'transaction' });
      }
      throw error;
    }
  }
}
