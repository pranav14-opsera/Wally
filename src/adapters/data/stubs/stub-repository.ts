import { randomUUID } from 'node:crypto';

import { DuplicateKeyError, EntityNotFoundError, TransactionError } from '../errors.js';
import { applyPagination, applySort, matchesFilter } from '../in-memory-query.js';
import type { IRepository } from '../interfaces/IRepository.js';
import type {
  BaseEntity,
  FilterOptions,
  PaginatedResult,
  PaginationOptions,
  SortOptions,
  TransactionContext,
} from '../types.js';

/** In-memory IRepository<T> for local development and testing. */
export class StubRepository<T extends BaseEntity> implements IRepository<T> {
  private readonly entities = new Map<string, T>();
  private inTransaction = false;

  public constructor(private readonly entityName: string) {}

  public async create(data: Omit<T, 'id' | 'created_at' | 'updated_at'>): Promise<T> {
    const providedId = (data as Partial<T>).id as string | undefined;
    const id = providedId ?? randomUUID();

    if (this.entities.has(id)) {
      throw new DuplicateKeyError(this.entityName, 'id');
    }

    const now = new Date();
    const entity = { ...data, id, created_at: now, updated_at: now } as T;
    this.entities.set(id, entity);
    return entity;
  }

  public async createMany(data: Array<Omit<T, 'id' | 'created_at' | 'updated_at'>>): Promise<T[]> {
    const created: T[] = [];
    for (const item of data) {
      created.push(await this.create(item));
    }
    return created;
  }

  public async findById(id: string): Promise<T | null> {
    return this.entities.get(id) ?? null;
  }

  public async findMany(
    filters?: FilterOptions<T>,
    sort?: SortOptions<T>,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<T>> {
    let results = [...this.entities.values()];
    if (filters) {
      results = results.filter((entity) => matchesFilter(entity, filters));
    }
    const total = results.length;
    results = applySort(results, sort);
    const { page, hasNext, nextCursor } = applyPagination(results, pagination);

    return { items: page, total, hasNext, ...(nextCursor ? { nextCursor } : {}) };
  }

  public async update(id: string, data: Partial<Omit<T, 'id' | 'created_at' | 'updated_at'>>): Promise<T> {
    const existing = this.entities.get(id);
    if (!existing) {
      throw new EntityNotFoundError(this.entityName, id);
    }

    const updated = { ...existing, ...data, id, updated_at: new Date() } as T;
    this.entities.set(id, updated);
    return updated;
  }

  public async delete(id: string): Promise<void> {
    if (!this.entities.has(id)) {
      throw new EntityNotFoundError(this.entityName, id);
    }
    this.entities.delete(id);
  }

  public async count(filters?: FilterOptions<T>): Promise<number> {
    if (!filters) {
      return this.entities.size;
    }
    return [...this.entities.values()].filter((entity) => matchesFilter(entity, filters)).length;
  }

  public async transaction<R>(fn: (ctx: TransactionContext) => Promise<R>): Promise<R> {
    if (this.inTransaction) {
      throw new TransactionError(
        `Nested transaction attempted on ${this.entityName} repository — this stub (and the real Prisma/Mongoose adapters) do not support nested transactions.`,
      );
    }

    this.inTransaction = true;
    try {
      return await fn({ id: randomUUID() });
    } finally {
      this.inTransaction = false;
    }
  }
}
