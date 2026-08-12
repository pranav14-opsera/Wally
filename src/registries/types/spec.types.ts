import type { SpecRegistryEntry } from '../../adapters/data/index.js';
import type { PaginatedResult } from './registry.types.js';

export type SpecEntry = SpecRegistryEntry;

// checksum is computed server-side (WO-026 constraint: "must be computed
// server-side, not accepted from client input") — never part of the
// create input.
export type CreateSpecInput = Omit<SpecEntry, 'id' | 'created_at' | 'updated_at' | 'checksum'>;

/**
 * Deliberately narrower than the other three registries' services — no
 * update()/deregister(). Spec versions are immutable once stored; this
 * interface makes it impossible to add mutation methods by accident at
 * the type level, per the WO's own implementation_hints.
 */
export interface ISpecRegistryService {
  register(input: unknown, actorId?: string | null): Promise<SpecEntry>;
  get(id: string): Promise<SpecEntry>;
  list(params?: unknown): Promise<PaginatedResult<SpecEntry>>;
  getLatestByApiName(apiName: string): Promise<SpecEntry>;
}
