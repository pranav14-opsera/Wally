import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { ToolRegistryEntry } from '../../../src/adapters/data/index.js';
import { createToolRegistryEntryFixture } from './fixtures/index.js';
import type { ContractHarness } from './setup.js';
import { createContractHarness, resolveEngine } from './setup.js';

/**
 * Query contract tests (WO-012 AC4, AC5): every `FilterOperator`, sort
 * ascending/descending, offset pagination, cursor pagination, and count()
 * — all against `ToolRegistryEntry` (no FK/parent dependency, so a batch
 * of records can be seeded directly without the User/AgentJob seeding
 * chain crud.contract.test.ts and composite.contract.test.ts need).
 */

const harness = await createContractHarness();
const engine = harness?.engine ?? resolveEngine();

const PREFIX = `query-${randomUUID()}`;

async function seedTools(activeHarness: ContractHarness, count: number): Promise<ToolRegistryEntry[]> {
  const created: ToolRegistryEntry[] = [];
  // Sequential, not Promise.all — cursor-pagination assertions below rely
  // on created_at strictly increasing in insertion order, which a
  // real database only guarantees under sequential writes at this
  // resolution (both engines store sub-millisecond-distinguishable
  // timestamps, but concurrent inserts could still race).
  for (let i = 0; i < count; i += 1) {
    const { id: _id, created_at: _c, updated_at: _u, ...input } = createToolRegistryEntryFixture({
      name: `${PREFIX}-${String(i).padStart(3, '0')}`,
      health_status: i % 2 === 0 ? 'healthy' : 'degraded',
    });
    // eslint-disable-next-line no-await-in-loop -- intentional: see comment above.
    created.push(await activeHarness.repositories.toolRegistry.create(input));
  }
  return created;
}

describe.skipIf(!harness)(`Query contract — ${engine}`, () => {
  const activeHarness = harness as ContractHarness;

  beforeEach(async () => {
    await activeHarness.cleanup();
  });

  afterAll(async () => {
    await activeHarness.teardown();
  });

  describe('filter operators', () => {
    it('eq matches only the exact value', async () => {
      await seedTools(activeHarness, 3);
      const target = `${PREFIX}-001`;

      const result = await activeHarness.repositories.toolRegistry.findMany({ name: { operator: 'eq', value: target } });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.name).toBe(target);
    });

    it('ne excludes the given value', async () => {
      await seedTools(activeHarness, 3);

      const result = await activeHarness.repositories.toolRegistry.findMany({
        name: { operator: 'ne', value: `${PREFIX}-001` },
      });

      expect(result.items.map((item) => item.name)).not.toContain(`${PREFIX}-001`);
      expect(result.items).toHaveLength(2);
    });

    it('in matches any value in the given set', async () => {
      await seedTools(activeHarness, 3);

      const result = await activeHarness.repositories.toolRegistry.findMany({
        health_status: { operator: 'in', value: ['healthy'] },
      });

      expect(result.items.every((item) => item.health_status === 'healthy')).toBe(true);
      expect(result.items).toHaveLength(2);
    });

    it('contains matches a substring, case-insensitively', async () => {
      const created = await seedTools(activeHarness, 1);
      const upperFragment = created[0]!.name.slice(-6).toUpperCase();

      const result = await activeHarness.repositories.toolRegistry.findMany({
        name: { operator: 'contains', value: upperFragment },
      });

      expect(result.items.map((item) => item.id)).toContain(created[0]!.id);
    });

    it('isNull matches only records where the field is null', async () => {
      const { id: _id, created_at: _c, updated_at: _u, ...withRef } = createToolRegistryEntryFixture({
        name: `${PREFIX}-withref`,
        credential_ref: 'secrets/present',
      });
      const { id: _id2, created_at: _c2, updated_at: _u2, ...withoutRef } = createToolRegistryEntryFixture({
        name: `${PREFIX}-noref`,
        credential_ref: null,
      });
      await activeHarness.repositories.toolRegistry.create(withRef);
      await activeHarness.repositories.toolRegistry.create(withoutRef);

      const result = await activeHarness.repositories.toolRegistry.findMany({
        credential_ref: { operator: 'isNull' },
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.name).toBe(`${PREFIX}-noref`);
    });

    it('gt/gte/lt/lte compare a numeric-like field (health-check timestamp)', async () => {
      const now = Date.now();
      const older = new Date(now - 60_000);
      const newer = new Date(now + 60_000);
      const { id: _id, created_at: _c, updated_at: _u, ...olderInput } = createToolRegistryEntryFixture({
        name: `${PREFIX}-older`,
        last_health_check: older,
      });
      const { id: _id2, created_at: _c2, updated_at: _u2, ...newerInput } = createToolRegistryEntryFixture({
        name: `${PREFIX}-newer`,
        last_health_check: newer,
      });
      await activeHarness.repositories.toolRegistry.create(olderInput);
      await activeHarness.repositories.toolRegistry.create(newerInput);

      const gtResult = await activeHarness.repositories.toolRegistry.findMany({
        last_health_check: { operator: 'gt', value: new Date(now) },
      });
      expect(gtResult.items.map((item) => item.name)).toEqual([`${PREFIX}-newer`]);

      const lteResult = await activeHarness.repositories.toolRegistry.findMany({
        last_health_check: { operator: 'lte', value: older },
      });
      expect(lteResult.items.map((item) => item.name)).toEqual([`${PREFIX}-older`]);
    });
  });

  describe('sort', () => {
    it('sorts ascending on a string field', async () => {
      await seedTools(activeHarness, 3);

      const result = await activeHarness.repositories.toolRegistry.findMany(undefined, { name: 'asc' });

      const names = result.items.map((item) => item.name).filter((name) => name.startsWith(PREFIX));
      expect(names).toEqual([...names].sort());
    });

    it('sorts descending on a string field', async () => {
      await seedTools(activeHarness, 3);

      const result = await activeHarness.repositories.toolRegistry.findMany(undefined, { name: 'desc' });

      const names = result.items.map((item) => item.name).filter((name) => name.startsWith(PREFIX));
      expect(names).toEqual([...names].sort().reverse());
    });
  });

  describe('pagination', () => {
    it('offset pagination returns the correct page, total, and hasNext', async () => {
      await seedTools(activeHarness, 5);

      const page1 = await activeHarness.repositories.toolRegistry.findMany(undefined, { name: 'asc' }, {
        kind: 'offset',
        offset: 0,
        limit: 2,
      });
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page1.hasNext).toBe(true);

      const page3 = await activeHarness.repositories.toolRegistry.findMany(undefined, { name: 'asc' }, {
        kind: 'offset',
        offset: 4,
        limit: 2,
      });
      expect(page3.items).toHaveLength(1);
      expect(page3.hasNext).toBe(false);
    });

    it('cursor pagination walks every record exactly once via nextCursor, ending with hasNext: false', async () => {
      const created = await seedTools(activeHarness, 5);
      const seenIds: string[] = [];
      let cursor: string | undefined;

      // Bounded by created.length + 1 (not while(true)) so a broken
      // hasNext/nextCursor contract fails this test with an assertion
      // instead of hanging the suite indefinitely.
      for (let i = 0; i <= created.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop -- sequential pagination walk is the point of this test.
        const page = await activeHarness.repositories.toolRegistry.findMany(undefined, { name: 'asc' }, {
          kind: 'cursor',
          limit: 2,
          cursor,
        });
        seenIds.push(...page.items.map((item) => item.id));
        if (!page.hasNext) {
          break;
        }
        cursor = page.nextCursor;
        expect(cursor).toBeTruthy();
      }

      expect(new Set(seenIds)).toEqual(new Set(created.map((item) => item.id)));
    });
  });

  describe('count', () => {
    it('counts all records with no filter', async () => {
      await seedTools(activeHarness, 4);

      const total = await activeHarness.repositories.toolRegistry.count();

      expect(total).toBe(4);
    });

    it('counts only records matching the given filter', async () => {
      await seedTools(activeHarness, 4);

      const healthyCount = await activeHarness.repositories.toolRegistry.count({
        health_status: { operator: 'eq', value: 'healthy' },
      });

      expect(healthyCount).toBe(2);
    });
  });
});
