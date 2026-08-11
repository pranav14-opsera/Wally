import type { BaseEntity, FilterCondition, FilterOptions, PaginationOptions, SortOptions } from '../types.js';

/**
 * The loosest type Prisma's generated `WhereInput`/`OrderByInput` objects
 * can be represented as generically across all 10 models — each model's
 * *actual* input type is more specific (and structurally compatible with
 * this), but a single generic query-builder can't thread Prisma's
 * per-model conditional types through `FilterOptions<T>` without either
 * ten near-identical non-generic builders or unsound `any`. Concrete
 * repositories pass the result to a properly-typed delegate at the one
 * boundary that needs it (see PrismaRepository.ts).
 */
export type PrismaWhereInput = Record<string, unknown>;
export type PrismaOrderByInput = Record<string, 'asc' | 'desc'>;

function buildFieldCondition<TValue>(condition: FilterCondition<TValue>): Record<string, unknown> {
  switch (condition.operator) {
    case 'eq':
      return { equals: condition.value };
    case 'ne':
      return { not: condition.value };
    case 'gt':
      return { gt: condition.value };
    case 'gte':
      return { gte: condition.value };
    case 'lt':
      return { lt: condition.value };
    case 'lte':
      return { lte: condition.value };
    case 'in':
      return { in: condition.value };
    case 'contains':
      return { contains: condition.value };
    case 'isNull':
      return { equals: null };
    default:
      // Exhaustiveness guard: FilterCondition['operator'] is a closed
      // union (QueryOperator) — this branch is unreachable at the type
      // level, but throws instead of silently building a no-op filter if
      // that union is ever extended without updating this function.
      throw new Error(`Unhandled filter operator: ${String((condition as FilterCondition<unknown>).operator)}`);
  }
}

/** Translates `FilterOptions<T>` (WO-007) into a Prisma `where` object. */
export function buildWhere<T extends BaseEntity>(filters?: FilterOptions<T>): PrismaWhereInput | undefined {
  if (!filters) {
    return undefined;
  }

  const where: PrismaWhereInput = {};
  for (const key of Object.keys(filters) as Array<keyof T>) {
    const condition = filters[key];
    if (condition) {
      where[key as string] = buildFieldCondition(condition);
    }
  }
  return Object.keys(where).length > 0 ? where : undefined;
}

/** Translates `SortOptions<T>` (WO-007) into a Prisma `orderBy` array — always an array so single- and multi-field sorts share one shape. */
export function buildOrderBy<T extends BaseEntity>(sort?: SortOptions<T>): PrismaOrderByInput[] | undefined {
  if (!sort) {
    return undefined;
  }

  const orderBy = (Object.entries(sort) as Array<[string, 'asc' | 'desc']>).map(([field, direction]) => ({
    [field]: direction,
  }));
  return orderBy.length > 0 ? orderBy : undefined;
}

export interface PrismaPaginationArgs {
  skip?: number;
  take?: number;
  cursor?: { id: string };
}

/**
 * Translates `PaginationOptions` (WO-007) into Prisma's skip/take/cursor
 * args. For cursor mode, `skip: 1` is Prisma's documented idiom for
 * excluding the cursor record itself from the returned page — omitted
 * on the first page, where there is no cursor yet to skip past. `take`
 * is requested as `limit + 1`: cursor pagination has no cumulative
 * position to compare against a total count the way offset pagination
 * does, so `hasNext` is instead derived by over-fetching one extra
 * record and checking whether it came back — see PrismaRepository.findMany,
 * which trims that probe record off before returning the page.
 */
export function buildPaginationArgs(pagination?: PaginationOptions): PrismaPaginationArgs {
  if (!pagination) {
    return {};
  }

  if (pagination.kind === 'offset') {
    return { skip: pagination.offset, take: pagination.limit };
  }

  return {
    take: pagination.limit + 1,
    ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
  };
}
