import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BaseEntity } from '../../../src/adapters/data/index.js';

// bootstrap() constructs a real FilesystemStorageAdapter (not a stub) for
// CLOUD_PROVIDER=local, which touches disk in its constructor — point it
// at an isolated temp directory so these tests don't create ./data/storage
// inside the repo, and clean it up afterward.
const TEST_STORAGE_PATH = join(tmpdir(), `wally-bootstrap-test-${randomUUID()}`);
const TEST_SECRETS_PATH = join(tmpdir(), `wally-bootstrap-test-secrets-${randomUUID()}.enc`);

const VALID_ENV = {
  NODE_ENV: 'test',
  CLOUD_PROVIDER: 'local',
  DATA_ENGINE: 'postgres',
  COMPUTE_RUNNER: 'local',
  POSTGRES_DB: 'wally_test',
  POSTGRES_USER: 'wally',
  POSTGRES_PASSWORD: 'test-password',
  POSTGRES_HOST: 'localhost',
  POSTGRES_PORT: '5432',
  REDIS_URL: 'redis://localhost:6379',
  JWT_PRIVATE_KEY_PATH: './secrets/jwt-private.pem',
  JWT_PUBLIC_KEY_PATH: './secrets/jwt-public.pem',
  LOCAL_SECRETS_MASTER_KEY: 'a'.repeat(32),
  LOG_LEVEL: 'silent',
  STORAGE_LOCAL_PATH: TEST_STORAGE_PATH,
  SECRETS_LOCAL_PATH: TEST_SECRETS_PATH,
};

describe('bootstrap', () => {
  const ORIGINAL_ENV = process.env;

  afterAll(async () => {
    await rm(TEST_STORAGE_PATH, { recursive: true, force: true });
    await rm(TEST_SECRETS_PATH, { force: true });
  });

  beforeEach(() => {
    vi.resetModules();
  });

  it('returns an AppContainer with every required property when config is valid', async () => {
    process.env = { ...ORIGINAL_ENV, ...VALID_ENV };
    const { bootstrap } = await import('../../../src/bootstrap.js');

    const container = await bootstrap();

    expect(container.config.CLOUD_PROVIDER).toBe('local');
    expect(container.logger).toBeDefined();
    expect(container.auditLogger).toBeDefined();
    expect(container.cloudStorage).toBeDefined();
    expect(container.cloudSecrets).toBeDefined();
    expect(container.cloudCompute).toBeDefined();
    expect(typeof container.createRepository).toBe('function');

    const repo = container.createRepository<BaseEntity & { name: string }>('TestEntity');
    const created = await repo.create({ name: 'sample' });
    expect(created.name).toBe('sample');
  });

  it('throws when config is invalid (missing required env vars)', async () => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test' };
    const { bootstrap } = await import('../../../src/bootstrap.js');

    await expect(bootstrap()).rejects.toThrow(/Configuration validation failed/);
  });

  it('returns a frozen container — mutation attempts throw in strict mode', async () => {
    process.env = { ...ORIGINAL_ENV, ...VALID_ENV };
    const { bootstrap } = await import('../../../src/bootstrap.js');

    const container = await bootstrap();

    expect(Object.isFrozen(container)).toBe(true);
    expect(() => {
      // @ts-expect-error intentional mutation attempt to verify immutability
      container.config = null;
    }).toThrow();
  });

  it('acts as a singleton — concurrent calls resolve to the same container instance', async () => {
    process.env = { ...ORIGINAL_ENV, ...VALID_ENV };
    const { bootstrap } = await import('../../../src/bootstrap.js');

    const [first, second, third] = await Promise.all([bootstrap(), bootstrap(), bootstrap()]);

    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('allows a retry after a failed bootstrap instead of permanently failing', async () => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test' };
    const { bootstrap } = await import('../../../src/bootstrap.js');

    await expect(bootstrap()).rejects.toThrow();

    process.env = { ...ORIGINAL_ENV, ...VALID_ENV };
    const container = await bootstrap();
    expect(container.config.CLOUD_PROVIDER).toBe('local');
  });

  it('fails with adapter-registration context when config selects a valid but unregistered provider', async () => {
    // CLOUD_PROVIDER=gcp passes config validation (it's a valid enum
    // value) but has no registered cloud storage adapter yet (only
    // local/aws are registered as of WO-018) — this is the "partial
    // initialization failure" edge case: cloudStorage is the first
    // adapter bootstrap resolves, so it must fail there specifically.
    process.env = {
      ...ORIGINAL_ENV,
      ...VALID_ENV,
      CLOUD_PROVIDER: 'gcp',
    };
    const { bootstrap } = await import('../../../src/bootstrap.js');

    await expect(bootstrap()).rejects.toThrow(/No cloud storage adapter registered for "gcp"/);
  });

  it('with CLOUD_PROVIDER=aws, cloudStorage resolves (S3StorageAdapter) but bootstrap still fails at the next unregistered step (cloudSecrets — AWS support lands in WO-019)', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      ...VALID_ENV,
      CLOUD_PROVIDER: 'aws',
      S3_BUCKET_NAME: 'wally-bootstrap-test-bucket',
      AWS_REGION: 'us-east-1',
    };
    const { bootstrap } = await import('../../../src/bootstrap.js');

    await expect(bootstrap()).rejects.toThrow(/No cloud secrets adapter registered for "aws"/);
  });
});
