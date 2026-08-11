import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AdapterRegistry,
  cloudStorageRegistry,
  createCloudComputeAdapter,
  createCloudSecretsAdapter,
  createCloudStorageAdapter,
  FilesystemStorageAdapter,
  LocalSecretsAdapter,
  StubComputeAdapter,
  StubStorageAdapter,
} from '../../../src/adapters/cloud/index.js';
import { createDataAdapter, StubRepository } from '../../../src/adapters/data/index.js';
import type { BaseEntity } from '../../../src/adapters/data/index.js';
import { AdapterNotRegisteredError } from '../../../src/adapters/errors.js';

describe('cloud adapter factories', () => {
  // createCloudStorageAdapter('local') now resolves the real
  // FilesystemStorageAdapter (WO-015), which calls getConfig() lazily —
  // populate process.env with a valid config, pointed at an isolated temp
  // directory, before that test runs.
  const ORIGINAL_ENV = process.env;
  const TEST_STORAGE_PATH = join(tmpdir(), `wally-factory-test-${randomUUID()}`);
  const TEST_SECRETS_PATH = join(tmpdir(), `wally-factory-test-secrets-${randomUUID()}.enc`);

  beforeAll(() => {
    process.env = {
      ...ORIGINAL_ENV,
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
  });

  afterAll(async () => {
    process.env = ORIGINAL_ENV;
    await rm(TEST_STORAGE_PATH, { recursive: true, force: true });
    await rm(TEST_SECRETS_PATH, { force: true });
  });

  it("createCloudStorageAdapter('local') returns a FilesystemStorageAdapter", () => {
    expect(createCloudStorageAdapter('local')).toBeInstanceOf(FilesystemStorageAdapter);
  });

  it("createCloudSecretsAdapter('local') returns a LocalSecretsAdapter", () => {
    expect(createCloudSecretsAdapter('local')).toBeInstanceOf(LocalSecretsAdapter);
  });

  it("createCloudComputeAdapter('local') returns a StubComputeAdapter", () => {
    expect(createCloudComputeAdapter('local')).toBeInstanceOf(StubComputeAdapter);
  });

  it('throws AdapterNotRegisteredError with the requested value and available list for an unregistered provider', () => {
    let thrown: Error | undefined;
    try {
      createCloudStorageAdapter('aws');
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeInstanceOf(AdapterNotRegisteredError);
    expect(thrown?.message).toContain('aws');
    expect(thrown?.message).toContain('local');
  });
});

describe('data adapter factory', () => {
  it("createDataAdapter('postgres') returns a factory producing a StubRepository", () => {
    const repositoryFactory = createDataAdapter('postgres');
    const repo = repositoryFactory<BaseEntity>('TestEntity');
    expect(repo).toBeInstanceOf(StubRepository);
  });

  it("createDataAdapter('mongo') also returns a StubRepository-producing factory", () => {
    const repositoryFactory = createDataAdapter('mongo');
    const repo = repositoryFactory<BaseEntity>('TestEntity');
    expect(repo).toBeInstanceOf(StubRepository);
  });
});

describe('AdapterRegistry', () => {
  it('allows dynamic registration of a new adapter at runtime', () => {
    interface FakeAdapter {
      readonly marker: 'fake';
    }
    const registry = new AdapterRegistry<FakeAdapter>('fake category');

    expect(() => registry.resolve('custom')).toThrow(AdapterNotRegisteredError);

    registry.register('custom', () => ({ marker: 'fake' }));
    expect(registry.resolve('custom')).toEqual({ marker: 'fake' });
  });

  it('the shared cloudStorageRegistry can also register a new provider at runtime', () => {
    // Uses a key outside CloudProvider's enum on purpose: it only needs to
    // prove the shared registry accepts runtime registration without
    // touching the 'aws'/'local' keys the other tests in this file assert
    // on, so this test has no ordering dependency on them.
    class FakeCustomStorageAdapter extends StubStorageAdapter {}
    cloudStorageRegistry.register('custom-e2e-provider', () => new FakeCustomStorageAdapter());

    expect(cloudStorageRegistry.resolve('custom-e2e-provider')).toBeInstanceOf(
      FakeCustomStorageAdapter,
    );
  });
});
