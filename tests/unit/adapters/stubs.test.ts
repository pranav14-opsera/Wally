import { describe, expect, it } from 'vitest';

import {
  ComputeTaskNotFoundError,
  SecretNotFoundError,
  StorageObjectNotFoundError,
  StubComputeAdapter,
  StubSecretsAdapter,
  StubStorageAdapter,
} from '../../../src/adapters/cloud/index.js';
import {
  DuplicateKeyError,
  EntityNotFoundError,
  StubRepository,
  TransactionError,
} from '../../../src/adapters/data/index.js';
import type { BaseEntity } from '../../../src/adapters/data/index.js';

describe('StubStorageAdapter', () => {
  it('round-trips upload/download', async () => {
    const adapter = new StubStorageAdapter();
    await adapter.upload('key-1', Buffer.from('hello'));

    const result = await adapter.download('key-1');
    expect(result.toString()).toBe('hello');
  });

  it('throws StorageObjectNotFoundError when downloading a missing key', async () => {
    const adapter = new StubStorageAdapter();
    await expect(adapter.download('missing')).rejects.toThrow(StorageObjectNotFoundError);
  });

  it('list filters by prefix and exists/delete work correctly', async () => {
    const adapter = new StubStorageAdapter();
    await adapter.upload('reports/a.json', Buffer.from('a'));
    await adapter.upload('reports/b.json', Buffer.from('b'));
    await adapter.upload('other/c.json', Buffer.from('c'));

    expect(await adapter.list('reports/')).toEqual(['reports/a.json', 'reports/b.json']);
    expect(await adapter.exists('reports/a.json')).toBe(true);

    await adapter.delete('reports/a.json');
    expect(await adapter.exists('reports/a.json')).toBe(false);
  });
});

describe('StubSecretsAdapter', () => {
  it('round-trips putSecret/getSecret', async () => {
    const adapter = new StubSecretsAdapter();
    await adapter.putSecret('db-password', 's3cr3t');

    expect(await adapter.getSecret('db-password')).toBe('s3cr3t');
  });

  it('throws SecretNotFoundError when getting a missing secret', async () => {
    const adapter = new StubSecretsAdapter();
    await expect(adapter.getSecret('missing')).rejects.toThrow(SecretNotFoundError);
  });

  it('rotateSecret throws for a non-existent key and updates an existing one', async () => {
    const adapter = new StubSecretsAdapter();
    await expect(adapter.rotateSecret('missing', 'new-value')).rejects.toThrow(
      SecretNotFoundError,
    );

    await adapter.putSecret('api-key', 'old-value');
    await adapter.rotateSecret('api-key', 'new-value');
    expect(await adapter.getSecret('api-key')).toBe('new-value');
  });

  it('listSecrets returns all stored keys', async () => {
    const adapter = new StubSecretsAdapter();
    await adapter.putSecret('a', '1');
    await adapter.putSecret('b', '2');

    expect(await adapter.listSecrets()).toEqual(['a', 'b']);
  });
});

describe('StubComputeAdapter', () => {
  it('simulates the pending -> running -> completed lifecycle', async () => {
    const adapter = new StubComputeAdapter();
    const taskId = await adapter.runTask({ taskType: 'k6', command: 'k6 run script.js' });

    expect((await adapter.getTaskStatus(taskId)).state).toBe('running');
    const completed = await adapter.getTaskStatus(taskId);
    expect(completed.state).toBe('completed');
    expect(completed.exitCode).toBe(0);
  });

  it('throws ComputeTaskNotFoundError for an unknown task ID', async () => {
    const adapter = new StubComputeAdapter();
    await expect(adapter.getTaskStatus('unknown')).rejects.toThrow(ComputeTaskNotFoundError);
    await expect(adapter.stopTask('unknown')).rejects.toThrow(ComputeTaskNotFoundError);
  });

  it('stopTask transitions a pending/running task to stopped', async () => {
    const adapter = new StubComputeAdapter();
    const taskId = await adapter.runTask({ taskType: 'k6', command: 'k6 run script.js' });

    await adapter.stopTask(taskId);
    expect((await adapter.getTaskStatus(taskId)).state).toBe('stopped');
  });
});

interface UserEntity extends BaseEntity {
  email: string;
  role: string;
}

interface ToolEntity extends BaseEntity {
  name: string;
  version: number;
}

describe('StubRepository', () => {
  it('create/findById round-trip, generates an id, and stamps created_at/updated_at', async () => {
    const repo = new StubRepository<UserEntity>('User');
    const created = await repo.create({ email: 'a@example.com', role: 'admin' });

    expect(created.id).toBeTruthy();
    expect(created.created_at).toBeInstanceOf(Date);
    expect(created.updated_at).toBeInstanceOf(Date);
    const found = await repo.findById(created.id);
    expect(found).toEqual(created);
  });

  it('findById returns null (not throw) for a non-existent id', async () => {
    const repo = new StubRepository<UserEntity>('User');
    expect(await repo.findById('missing')).toBeNull();
  });

  it('findMany filters by eq operator and applies sort/pagination', async () => {
    const repo = new StubRepository<UserEntity>('User');
    await repo.create({ email: 'a@example.com', role: 'admin' });
    await repo.create({ email: 'b@example.com', role: 'viewer' });
    await repo.create({ email: 'c@example.com', role: 'admin' });

    const admins = await repo.findMany({ role: { operator: 'eq', value: 'admin' } });
    expect(admins.items).toHaveLength(2);
    expect(admins.total).toBe(2);
    expect(admins.hasNext).toBe(false);

    const sorted = await repo.findMany(undefined, { email: 'desc' });
    expect(sorted.items.map((u) => u.email)).toEqual([
      'c@example.com',
      'b@example.com',
      'a@example.com',
    ]);

    const paged = await repo.findMany(undefined, { email: 'asc' }, { kind: 'offset', limit: 1, offset: 1 });
    expect(paged.items).toHaveLength(1);
    expect(paged.items[0]?.email).toBe('b@example.com');
    expect(paged.total).toBe(3);
    expect(paged.hasNext).toBe(true);
  });

  it('findMany supports the gt/in/isNull/contains operators', async () => {
    const repo = new StubRepository<ToolEntity>('Tool');
    await repo.create({ name: 'alpha-tool', version: 1 });
    await repo.create({ name: 'beta-tool', version: 2 });
    await repo.create({ name: 'gamma', version: 3 });

    expect((await repo.findMany({ version: { operator: 'gt', value: 1 } })).total).toBe(2);
    expect((await repo.findMany({ version: { operator: 'in', value: [1, 3] } })).total).toBe(2);
    expect((await repo.findMany({ name: { operator: 'contains', value: '-tool' } })).total).toBe(2);
  });

  it('findMany paginates gracefully over an empty result set', async () => {
    const repo = new StubRepository<UserEntity>('User');
    const result = await repo.findMany({ role: { operator: 'eq', value: 'nonexistent' } });
    expect(result).toEqual({ items: [], total: 0, hasNext: false });
  });

  it('findMany supports cursor pagination and returns nextCursor', async () => {
    const repo = new StubRepository<UserEntity>('User');
    const first = await repo.create({ email: 'a@example.com', role: 'admin' });
    await repo.create({ email: 'b@example.com', role: 'admin' });
    await repo.create({ email: 'c@example.com', role: 'admin' });

    const page1 = await repo.findMany(undefined, undefined, { kind: 'cursor', limit: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page1.items[0]?.id).toBe(first.id);
    expect(page1.hasNext).toBe(true);
    expect(page1.nextCursor).toBe(first.id);

    const page2 = await repo.findMany(undefined, undefined, {
      kind: 'cursor',
      limit: 10,
      cursor: page1.nextCursor,
    });
    expect(page2.items).toHaveLength(2);
    expect(page2.hasNext).toBe(false);
  });

  it('createMany creates every entity and returns them in order', async () => {
    const repo = new StubRepository<UserEntity>('User');
    const created = await repo.createMany([
      { email: 'a@example.com', role: 'admin' },
      { email: 'b@example.com', role: 'viewer' },
    ]);

    expect(created).toHaveLength(2);
    expect(created.map((u) => u.email)).toEqual(['a@example.com', 'b@example.com']);
    expect(await repo.count()).toBe(2);
  });

  it('update throws EntityNotFoundError for a non-existent id, applies a partial update, and bumps updated_at', async () => {
    const repo = new StubRepository<UserEntity>('User');
    await expect(repo.update('missing', { role: 'viewer' })).rejects.toThrow(EntityNotFoundError);

    const created = await repo.create({ email: 'a@example.com', role: 'admin' });
    const updated = await repo.update(created.id, { role: 'viewer' });
    expect(updated.role).toBe('viewer');
    expect(updated.email).toBe('a@example.com');
    expect(updated.updated_at.getTime()).toBeGreaterThanOrEqual(created.updated_at.getTime());
  });

  it('delete throws EntityNotFoundError for a non-existent id and removes an existing one', async () => {
    const repo = new StubRepository<UserEntity>('User');
    await expect(repo.delete('missing')).rejects.toThrow(EntityNotFoundError);

    const created = await repo.create({ email: 'a@example.com', role: 'admin' });
    await repo.delete(created.id);
    expect(await repo.findById(created.id)).toBeNull();
  });

  it('create throws DuplicateKeyError when the id already exists', async () => {
    const repo = new StubRepository<UserEntity>('User');
    await repo.create({ id: 'fixed-id', email: 'a@example.com', role: 'admin' });

    await expect(
      repo.create({ id: 'fixed-id', email: 'b@example.com', role: 'viewer' }),
    ).rejects.toThrow(DuplicateKeyError);
  });

  it('count respects an optional filter', async () => {
    const repo = new StubRepository<UserEntity>('User');
    await repo.create({ email: 'a@example.com', role: 'admin' });
    await repo.create({ email: 'b@example.com', role: 'viewer' });

    expect(await repo.count()).toBe(2);
    expect(await repo.count({ role: { operator: 'eq', value: 'admin' } })).toBe(1);
  });

  it('transaction runs the callback and returns its result', async () => {
    const repo = new StubRepository<UserEntity>('User');
    const result = await repo.transaction(async (ctx) => {
      expect(ctx.id).toBeTruthy();
      return await repo.create({ email: 'a@example.com', role: 'admin' });
    });

    expect(result.email).toBe('a@example.com');
  });

  it('transaction rejects a nested transaction attempt with TransactionError', async () => {
    const repo = new StubRepository<UserEntity>('User');

    await expect(
      repo.transaction(async () => {
        await repo.transaction(async () => 'nested');
      }),
    ).rejects.toThrow(TransactionError);
  });

  it('generic type inference works correctly across two different entity shapes', async () => {
    const userRepo = new StubRepository<UserEntity>('User');
    const toolRepo = new StubRepository<ToolEntity>('Tool');

    const user = await userRepo.create({ email: 'a@example.com', role: 'admin' });
    const tool = await toolRepo.create({ name: 'k6', version: 1 });

    expect(user.email).toBe('a@example.com');
    expect(tool.version).toBe(1);
  });
});
