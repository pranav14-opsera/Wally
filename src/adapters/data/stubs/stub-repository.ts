import { randomUUID } from 'node:crypto';

import type { FilterQuery, IRepository, QueryOptions } from '../interfaces.js';
import { DuplicateEntityError, EntityNotFoundError } from '../interfaces.js';

function matchesFilter<T extends { id: string }>(entity: T, filter: FilterQuery<T>): boolean {
  return (Object.keys(filter) as Array<keyof T>).every((key) => entity[key] === filter[key]);
}

function applySort<T extends { id: string }>(
  entities: T[],
  sort: Record<string, 'asc' | 'desc'> | undefined,
): T[] {
  if (!sort) {
    return entities;
  }

  const [field, direction] = Object.entries(sort)[0] ?? [];
  if (!field) {
    return entities;
  }

  const sorted = [...entities].sort((a, b) => {
    const aValue = a[field as keyof T];
    const bValue = b[field as keyof T];
    if (aValue === bValue) {
      return 0;
    }
    return aValue < bValue ? -1 : 1;
  });

  return direction === 'desc' ? sorted.reverse() : sorted;
}

function applySelect<T extends { id: string }>(
  entities: T[],
  select: string[] | undefined,
): T[] {
  if (!select || select.length === 0) {
    return entities;
  }

  return entities.map((entity) => {
    const picked = {} as T;
    for (const field of select) {
      (picked as Record<string, unknown>)[field] = (entity as Record<string, unknown>)[field];
    }
    // `id` is always present so consumers can still identify the record.
    (picked as Record<string, unknown>).id = entity.id;
    return picked;
  });
}

/** In-memory IRepository<T> for local development and testing. */
export class StubRepository<T extends { id: string }> implements IRepository<T> {
  private readonly entities = new Map<string, T>();

  public constructor(private readonly entityName: string) {}

  public async create(data: Partial<T>): Promise<T> {
    const id = (data.id as string | undefined) ?? randomUUID();

    if (this.entities.has(id)) {
      throw new DuplicateEntityError(this.entityName, 'id');
    }

    const entity = { ...data, id } as T;
    this.entities.set(id, entity);
    return entity;
  }

  public async findById(id: string): Promise<T | null> {
    return this.entities.get(id) ?? null;
  }

  public async findMany(filter: FilterQuery<T>, options?: QueryOptions): Promise<T[]> {
    let results = [...this.entities.values()].filter((entity) => matchesFilter(entity, filter));

    results = applySort(results, options?.sort);

    const offset = options?.offset ?? 0;
    const limit = options?.limit;
    results = limit === undefined ? results.slice(offset) : results.slice(offset, offset + limit);

    return applySelect(results, options?.select);
  }

  public async update(id: string, data: Partial<T>): Promise<T> {
    const existing = this.entities.get(id);
    if (!existing) {
      throw new EntityNotFoundError(this.entityName, id);
    }

    const updated = { ...existing, ...data, id } as T;
    this.entities.set(id, updated);
    return updated;
  }

  public async delete(id: string): Promise<void> {
    if (!this.entities.has(id)) {
      throw new EntityNotFoundError(this.entityName, id);
    }
    this.entities.delete(id);
  }

  public async count(filter?: FilterQuery<T>): Promise<number> {
    if (!filter) {
      return this.entities.size;
    }
    return [...this.entities.values()].filter((entity) => matchesFilter(entity, filter)).length;
  }
}
