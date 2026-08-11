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
  DuplicateEntityError,
  EntityNotFoundError,
  StubRepository,
} from '../../../src/adapters/data/index.js';

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

interface UserEntity {
  id: string;
  email: string;
  role: string;
}

interface ToolEntity {
  id: string;
  name: string;
  version: number;
}

describe('StubRepository', () => {
  it('create/findById round-trip and generates an id when omitted', async () => {
    const repo = new StubRepository<UserEntity>('User');
    const created = await repo.create({ email: 'a@example.com', role: 'admin' });

    expect(created.id).toBeTruthy();
    const found = await repo.findById(created.id);
    expect(found).toEqual(created);
  });

  it('findById returns null (not throw) for a non-existent id', async () => {
    const repo = new StubRepository<UserEntity>('User');
    expect(await repo.findById('missing')).toBeNull();
  });

  it('findMany filters by equality and applies limit/offset/sort', async () => {
    const repo = new StubRepository<UserEntity>('User');
    await repo.create({ email: 'a@example.com', role: 'admin' });
    await repo.create({ email: 'b@example.com', role: 'viewer' });
    await repo.create({ email: 'c@example.com', role: 'admin' });

    const admins = await repo.findMany({ role: 'admin' });
    expect(admins).toHaveLength(2);

    const sorted = await repo.findMany({}, { sort: { email: 'desc' } });
    expect(sorted.map((u) => u.email)).toEqual(['c@example.com', 'b@example.com', 'a@example.com']);

    const paged = await repo.findMany({}, { limit: 1, offset: 1, sort: { email: 'asc' } });
    expect(paged).toHaveLength(1);
    expect(paged[0]?.email).toBe('b@example.com');
  });

  it('update throws EntityNotFoundError for a non-existent id and applies a partial update', async () => {
    const repo = new StubRepository<UserEntity>('User');
    await expect(repo.update('missing', { role: 'viewer' })).rejects.toThrow(EntityNotFoundError);

    const created = await repo.create({ email: 'a@example.com', role: 'admin' });
    const updated = await repo.update(created.id, { role: 'viewer' });
    expect(updated.role).toBe('viewer');
    expect(updated.email).toBe('a@example.com');
  });

  it('delete throws EntityNotFoundError for a non-existent id and removes an existing one', async () => {
    const repo = new StubRepository<UserEntity>('User');
    await expect(repo.delete('missing')).rejects.toThrow(EntityNotFoundError);

    const created = await repo.create({ email: 'a@example.com', role: 'admin' });
    await repo.delete(created.id);
    expect(await repo.findById(created.id)).toBeNull();
  });

  it('create throws DuplicateEntityError when the id already exists', async () => {
    const repo = new StubRepository<UserEntity>('User');
    await repo.create({ id: 'fixed-id', email: 'a@example.com', role: 'admin' });

    await expect(
      repo.create({ id: 'fixed-id', email: 'b@example.com', role: 'viewer' }),
    ).rejects.toThrow(DuplicateEntityError);
  });

  it('count respects an optional filter', async () => {
    const repo = new StubRepository<UserEntity>('User');
    await repo.create({ email: 'a@example.com', role: 'admin' });
    await repo.create({ email: 'b@example.com', role: 'viewer' });

    expect(await repo.count()).toBe(2);
    expect(await repo.count({ role: 'admin' })).toBe(1);
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
