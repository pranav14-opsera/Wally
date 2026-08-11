import { describe, expect, it } from 'vitest';

import {
  AdapterRegistry,
  cloudStorageRegistry,
  createCloudComputeAdapter,
  createCloudSecretsAdapter,
  createCloudStorageAdapter,
  StubComputeAdapter,
  StubSecretsAdapter,
  StubStorageAdapter,
} from '../../../src/adapters/cloud/index.js';
import { createDataAdapter, StubRepository } from '../../../src/adapters/data/index.js';
import { AdapterNotRegisteredError } from '../../../src/adapters/errors.js';

describe('cloud adapter factories', () => {
  it("createCloudStorageAdapter('local') returns a StubStorageAdapter", () => {
    expect(createCloudStorageAdapter('local')).toBeInstanceOf(StubStorageAdapter);
  });

  it("createCloudSecretsAdapter('local') returns a StubSecretsAdapter", () => {
    expect(createCloudSecretsAdapter('local')).toBeInstanceOf(StubSecretsAdapter);
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
    const repo = repositoryFactory<{ id: string }>('TestEntity');
    expect(repo).toBeInstanceOf(StubRepository);
  });

  it("createDataAdapter('mongo') also returns a StubRepository-producing factory", () => {
    const repositoryFactory = createDataAdapter('mongo');
    const repo = repositoryFactory<{ id: string }>('TestEntity');
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
