import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { DuplicateKeyError, EntityNotFoundError, ValidationError } from '../../../src/adapters/data/index.js';
import { createToolRegistryEntryFixture } from './fixtures/index.js';
import type { ContractHarness } from './setup.js';
import { createContractHarness, resolveEngine } from './setup.js';

/**
 * Error-normalization contract tests (WO-012 AC7): every driver-specific
 * failure a repository method can hit must surface as the same
 * `DataAdapterError` subclass regardless of which engine produced it —
 * `ToolRegistryEntry` is used throughout since its unique `name` index
 * exists identically on both engines (schema.prisma's `@unique` /
 * ToolRegistry.schema.ts's `unique: true`) with no FK/parent dependency
 * to seed first.
 */

const harness = await createContractHarness();
const engine = harness?.engine ?? resolveEngine();

describe.skipIf(!harness)(`Error normalization contract — ${engine}`, () => {
  const activeHarness = harness as ContractHarness;

  beforeEach(async () => {
    await activeHarness.cleanup();
  });

  afterAll(async () => {
    await activeHarness.teardown();
  });

  it('create() with a duplicate unique field throws DuplicateKeyError', async () => {
    const repo = activeHarness.repositories.toolRegistry;
    const name = `error-dup-${randomUUID()}`;
    const { id: _i1, created_at: _c1, updated_at: _u1, ...first } = createToolRegistryEntryFixture({ name });
    const { id: _i2, created_at: _c2, updated_at: _u2, ...second } = createToolRegistryEntryFixture({ name });
    await repo.create(first);

    await expect(repo.create(second)).rejects.toBeInstanceOf(DuplicateKeyError);
  });

  it('update() on a non-existent id throws EntityNotFoundError', async () => {
    const repo = activeHarness.repositories.toolRegistry;

    await expect(repo.update(randomUUID(), { description: 'updated' })).rejects.toBeInstanceOf(EntityNotFoundError);
  });

  it('delete() on a non-existent id throws EntityNotFoundError', async () => {
    const repo = activeHarness.repositories.toolRegistry;

    await expect(repo.delete(randomUUID())).rejects.toBeInstanceOf(EntityNotFoundError);
  });

  it('findMany() with a structurally invalid filter value throws ValidationError', async () => {
    const repo = activeHarness.repositories.toolRegistry;

    // 'in' requires an array per FilterCondition's contract (WO-007) — a
    // caller that violates it at runtime (bypassing the type system, e.g.
    // from an untyped request body) must get a clear ValidationError from
    // both engines' query builders, not an opaque driver-level exception.
    await expect(
      repo.findMany({
        name: { operator: 'in', value: 'not-an-array' as unknown as string[] },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
