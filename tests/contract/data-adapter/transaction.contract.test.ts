import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { TransactionError } from '../../../src/adapters/data/index.js';
import { createToolRegistryEntryFixture } from './fixtures/index.js';
import type { ContractHarness } from './setup.js';
import { createContractHarness, resolveEngine } from './setup.js';

/**
 * Transaction contract tests (WO-012 AC6): a successful multi-operation
 * transaction commits every write atomically; a transaction whose
 * callback throws rolls every write back; a nested transaction attempt on
 * the same repository is rejected with `TransactionError` rather than
 * silently flattened (both PrismaRepository and MongooseRepository make
 * this same guarantee — see each repository's own `transaction()` doc
 * comment). `ToolRegistryEntry` is used throughout: no FK/parent
 * dependency, so the test bodies stay focused on transaction semantics
 * rather than seeding boilerplate.
 *
 * Transaction *timeout* behavior (implementation_steps' third bullet) is
 * deliberately not asserted here: both adapters hardcode their timeout
 * internally (see PrismaRepository.ts's TRANSACTION_TIMEOUT_MS and the
 * identical rationale in MongooseRepository) since `IRepository.
 * transaction<R>` (WO-007) exposes no options parameter to trigger one
 * through — a real timeout test would need to either sleep past a
 * multi-second hardcoded value (slow, flaky under CI load) or reach past
 * the public `IRepository` contract into adapter internals, neither of
 * which belongs in an engine-agnostic contract suite.
 */

const harness = await createContractHarness();
const engine = harness?.engine ?? resolveEngine();

describe.skipIf(!harness)(`Transaction contract — ${engine}`, () => {
  const activeHarness = harness as ContractHarness;

  beforeEach(async () => {
    await activeHarness.cleanup();
  });

  afterAll(async () => {
    await activeHarness.teardown();
  });

  it('commits every write inside a successful transaction atomically', async () => {
    const repo = activeHarness.repositories.toolRegistry;
    const { id: _i1, created_at: _c1, updated_at: _u1, ...first } = createToolRegistryEntryFixture({
      name: `tx-commit-a-${randomUUID()}`,
    });
    const { id: _i2, created_at: _c2, updated_at: _u2, ...second } = createToolRegistryEntryFixture({
      name: `tx-commit-b-${randomUUID()}`,
    });

    await repo.transaction(async () => {
      await repo.create(first);
      await repo.create(second);
    });

    const total = await repo.count();
    expect(total).toBe(2);
  });

  it('rolls back every write when the transaction callback throws', async () => {
    const repo = activeHarness.repositories.toolRegistry;
    const { id: _id, created_at: _c, updated_at: _u, ...input } = createToolRegistryEntryFixture({
      name: `tx-rollback-${randomUUID()}`,
    });

    class DeliberateRollback extends Error {}

    await expect(
      repo.transaction(async () => {
        await repo.create(input);
        throw new DeliberateRollback('trigger rollback');
      }),
    ).rejects.toBeInstanceOf(DeliberateRollback);

    const total = await repo.count();
    expect(total).toBe(0);
  });

  it('propagates the transaction callback result on success', async () => {
    const repo = activeHarness.repositories.toolRegistry;
    const { id: _id, created_at: _c, updated_at: _u, ...input } = createToolRegistryEntryFixture({
      name: `tx-result-${randomUUID()}`,
    });

    const createdId = await repo.transaction(async () => {
      const created = await repo.create(input);
      return created.id;
    });

    expect(createdId).toBeTruthy();
    const found = await repo.findById(createdId);
    expect(found).not.toBeNull();
  });

  it('rejects a nested transaction attempt on the same repository with TransactionError', async () => {
    const repo = activeHarness.repositories.toolRegistry;

    await expect(
      repo.transaction(async () => repo.transaction(async () => 'nested')),
    ).rejects.toBeInstanceOf(TransactionError);
  });
});
