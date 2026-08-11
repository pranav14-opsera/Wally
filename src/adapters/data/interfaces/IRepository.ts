import type {
  BaseEntity,
  FilterOptions,
  PaginatedResult,
  PaginationOptions,
  SortOptions,
  TransactionContext,
} from '../types.js';

/**
 * The single generic data-access contract every entity's repository
 * implements — Prisma/Postgres and Mongoose/MongoDB adapters (later
 * epics) satisfy this identically so consumers never know which engine
 * is behind `DATA_ENGINE`. No database-specific concept (Prisma
 * `include`, Mongoose `populate`) may appear in this interface.
 */
export interface IRepository<T extends BaseEntity> {
  findById(id: string): Promise<T | null>;
  findMany(
    filters?: FilterOptions<T>,
    sort?: SortOptions<T>,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<T>>;
  create(data: Omit<T, 'id' | 'created_at' | 'updated_at'>): Promise<T>;
  createMany(data: Array<Omit<T, 'id' | 'created_at' | 'updated_at'>>): Promise<T[]>;
  update(id: string, data: Partial<Omit<T, 'id' | 'created_at' | 'updated_at'>>): Promise<T>;
  delete(id: string): Promise<void>;
  count(filters?: FilterOptions<T>): Promise<number>;
  /**
   * Runs `fn` inside a database transaction. Concrete adapters map this
   * to Prisma's `$transaction` or a Mongoose session internally — nothing
   * driver-specific is exposed through `TransactionContext`. Nested
   * transaction attempts (calling `transaction()` again from within `fn`
   * on the same repository) must be rejected with a `TransactionError`,
   * not silently flattened.
   */
  transaction<R>(fn: (ctx: TransactionContext) => Promise<R>): Promise<R>;
}
