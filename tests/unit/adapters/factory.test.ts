import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  AdapterRegistry,
  AzureComputeStub,
  AzureSecretsStub,
  AzureStorageStub,
  cloudSecretsRegistry,
  cloudStorageRegistry,
  createCloudAdapters,
  createCloudComputeAdapter,
  createCloudSecretsAdapter,
  createCloudStorageAdapter,
  FilesystemStorageAdapter,
  GcpComputeStub,
  GcpSecretsStub,
  GcpStorageStub,
  LocalComputeRunner,
  LocalSecretsAdapter,
  S3StorageAdapter,
  SecretsManagerAdapter,
  StubStorageAdapter,
} from '../../../src/adapters/cloud/index.js';
import { buildDataAdapterConfig, ConnectionError, createDataAdapter } from '../../../src/adapters/data/index.js';
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
      S3_BUCKET_NAME: 'wally-factory-test-bucket',
      AWS_REGION: 'us-east-1',
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

  it("createCloudSecretsAdapter('aws') returns a SecretsManagerAdapter (WO-019)", () => {
    expect(createCloudSecretsAdapter('aws')).toBeInstanceOf(SecretsManagerAdapter);
  });

  it("createCloudComputeAdapter('local') returns a LocalComputeRunner", () => {
    expect(createCloudComputeAdapter('local')).toBeInstanceOf(LocalComputeRunner);
  });

  it("createCloudStorageAdapter('aws') returns an S3StorageAdapter", () => {
    expect(createCloudStorageAdapter('aws')).toBeInstanceOf(S3StorageAdapter);
  });

  it("createCloudStorageAdapter('gcp'/'azure') returns the corresponding stub (WO-021)", () => {
    expect(createCloudStorageAdapter('gcp')).toBeInstanceOf(GcpStorageStub);
    expect(createCloudStorageAdapter('azure')).toBeInstanceOf(AzureStorageStub);
  });

  it("createCloudSecretsAdapter('gcp'/'azure') returns the corresponding stub (WO-021)", () => {
    expect(createCloudSecretsAdapter('gcp')).toBeInstanceOf(GcpSecretsStub);
    expect(createCloudSecretsAdapter('azure')).toBeInstanceOf(AzureSecretsStub);
  });

  it("createCloudComputeAdapter('gcp'/'azure') returns the corresponding stub (WO-021)", () => {
    expect(createCloudComputeAdapter('gcp')).toBeInstanceOf(GcpComputeStub);
    expect(createCloudComputeAdapter('azure')).toBeInstanceOf(AzureComputeStub);
  });

  it('throws AdapterNotRegisteredError with the requested value and available list for a truly unregistered provider', () => {
    // 'aws' compute (ECSComputeRunner, WO-020) is the one gap still open —
    // local/aws/gcp/azure are all registered for storage and secrets now.
    let thrown: Error | undefined;
    try {
      createCloudComputeAdapter('aws');
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeInstanceOf(AdapterNotRegisteredError);
    expect(thrown?.message).toContain('aws');
    expect(thrown?.message).toContain('local');
  });

  describe('createCloudAdapters', () => {
    it("CLOUD_PROVIDER=local returns FilesystemStorageAdapter, LocalSecretsAdapter, and LocalComputeRunner", () => {
      const adapters = createCloudAdapters({ cloudProvider: 'local', computeRunner: 'local' });

      expect(adapters.storage).toBeInstanceOf(FilesystemStorageAdapter);
      expect(adapters.secrets).toBeInstanceOf(LocalSecretsAdapter);
      expect(adapters.compute).toBeInstanceOf(LocalComputeRunner);
    });

    it('CLOUD_PROVIDER=aws returns S3StorageAdapter, SecretsManagerAdapter, and (with COMPUTE_RUNNER=local) LocalComputeRunner', () => {
      // COMPUTE_RUNNER=local overrides compute to LocalComputeRunner
      // regardless of CLOUD_PROVIDER — ECSComputeRunner (WO-020) is the
      // one still-unregistered 'aws' slot, asserted separately above.
      const adapters = createCloudAdapters({ cloudProvider: 'aws', computeRunner: 'local' });

      expect(adapters.storage).toBeInstanceOf(S3StorageAdapter);
      expect(adapters.secrets).toBeInstanceOf(SecretsManagerAdapter);
      expect(adapters.compute).toBeInstanceOf(LocalComputeRunner);
    });

    it('CLOUD_PROVIDER=gcp returns all three GCP stubs', () => {
      const adapters = createCloudAdapters({ cloudProvider: 'gcp', computeRunner: 'local' });
      expect(adapters.storage).toBeInstanceOf(GcpStorageStub);
      expect(adapters.compute).toBeInstanceOf(LocalComputeRunner);
    });

    it('CLOUD_PROVIDER=gcp with COMPUTE_RUNNER=cloud returns GcpComputeStub for compute', () => {
      const adapters = createCloudAdapters({ cloudProvider: 'gcp', computeRunner: 'cloud' });
      expect(adapters.compute).toBeInstanceOf(GcpComputeStub);
    });

    it('CLOUD_PROVIDER=azure with COMPUTE_RUNNER=cloud returns AzureComputeStub for compute', () => {
      const adapters = createCloudAdapters({ cloudProvider: 'azure', computeRunner: 'cloud' });
      expect(adapters.compute).toBeInstanceOf(AzureComputeStub);
    });

    it('an unrecognized CLOUD_PROVIDER throws a descriptive error listing valid options', () => {
      expect(() =>
        createCloudAdapters({ cloudProvider: 'openstack' as unknown as 'local', computeRunner: 'local' }),
      ).toThrow(/Invalid CLOUD_PROVIDER.*openstack.*local.*aws.*gcp.*azure/s);
    });

    it('an empty-string CLOUD_PROVIDER is treated as invalid, not silently defaulted', () => {
      expect(() => createCloudAdapters({ cloudProvider: '' as unknown as 'local', computeRunner: 'local' })).toThrow(
        /Invalid CLOUD_PROVIDER/,
      );
    });

    it('COMPUTE_RUNNER=local always selects LocalComputeRunner regardless of CLOUD_PROVIDER', () => {
      for (const cloudProvider of ['local', 'aws', 'gcp', 'azure'] as const) {
        const adapters = createCloudAdapters({ cloudProvider, computeRunner: 'local' });
        expect(adapters.compute).toBeInstanceOf(LocalComputeRunner);
      }
    });

    it('COMPUTE_RUNNER=cloud with CLOUD_PROVIDER=local throws a descriptive CONFIGURATION_ERROR', () => {
      expect(() => createCloudAdapters({ cloudProvider: 'local', computeRunner: 'cloud' })).toThrow(
        /COMPUTE_RUNNER=cloud requires a cloud CLOUD_PROVIDER/,
      );
    });

    it('called multiple times, returns new instances each time (no singleton leakage)', () => {
      const first = createCloudAdapters({ cloudProvider: 'local', computeRunner: 'local' });
      const second = createCloudAdapters({ cloudProvider: 'local', computeRunner: 'local' });

      expect(first.storage).not.toBe(second.storage);
      expect(first.secrets).not.toBe(second.secrets);
      expect(first.compute).not.toBe(second.compute);
    });

    it('falls back to getConfig() (CLOUD_PROVIDER=local, COMPUTE_RUNNER=local from the test env) when called with no arguments', () => {
      const adapters = createCloudAdapters();
      expect(adapters.storage).toBeInstanceOf(FilesystemStorageAdapter);
      expect(adapters.compute).toBeInstanceOf(LocalComputeRunner);
    });

    it('a partial override merges with getConfig() for the omitted field', () => {
      // Only cloudProvider is overridden; computeRunner falls back to the
      // test env's COMPUTE_RUNNER=local — this exercises the `config?.x ?? appConfig.X`
      // merge logic in createCloudAdapters, not just the "no args at all" path above.
      const adapters = createCloudAdapters({ cloudProvider: 'gcp' });
      expect(adapters.storage).toBeInstanceOf(GcpStorageStub);
      expect(adapters.compute).toBeInstanceOf(LocalComputeRunner);
    });
  });
});

// Hoisted so the same mock functions can be referenced both inside the
// vi.mock() factories below (which vitest hoists above these imports) and
// reconfigured per-test (mockResolvedValueOnce, mockReset) — a plain
// `const` declared after vi.mock() calls would be hoisted-above by
// vitest's transform without ever being initialized yet, which is exactly
// the pitfall vi.hoisted() exists to avoid.
const { prismaHealthCheckMock, prismaDisconnectMock, mongoHealthCheckMock, mongoDisconnectMock } = vi.hoisted(() => ({
  prismaHealthCheckMock: vi.fn(async () => true),
  prismaDisconnectMock: vi.fn(async () => undefined),
  mongoHealthCheckMock: vi.fn(async () => true),
  mongoDisconnectMock: vi.fn(async () => undefined),
}));

// factory.ts dynamically `import()`s these six modules rather than
// statically importing Prisma/Mongoose at the top level (so selecting one
// DATA_ENGINE never loads the other engine's driver) — mocking them here
// verifies the factory wires each engine's repositories and health
// check/disconnect correctly without needing a real Postgres/Mongo
// instance, per this WO's own AC8 ("using mocked adapters").
vi.mock('../../../src/adapters/data/prisma/prisma-client.js', () => ({
  getPrismaClient: vi.fn(() => ({ marker: 'fake-prisma-client' })),
  healthCheck: prismaHealthCheckMock,
  disconnectPrismaClient: prismaDisconnectMock,
}));
vi.mock('../../../src/adapters/data/prisma/PrismaRepository.js', () => {
  class FakePrismaRepository {
    public constructor(
      public readonly prisma: unknown,
      public readonly getDelegate: unknown,
      public readonly entityName: string,
      public readonly logger: unknown,
    ) {}
  }
  return { PrismaRepository: FakePrismaRepository };
});
vi.mock('../../../src/adapters/data/prisma/PrismaAgentJobRepository.js', () => {
  class FakePrismaAgentJobRepository {
    public constructor(
      public readonly prisma: unknown,
      public readonly logger: unknown,
    ) {}
  }
  return { PrismaAgentJobRepository: FakePrismaAgentJobRepository };
});

vi.mock('../../../src/adapters/data/mongoose/mongoose-client.js', () => ({
  getMongooseModels: vi.fn(async () => ({
    User: { marker: 'User' },
    AgentJob: { marker: 'AgentJob' },
    ToolRegistry: { marker: 'ToolRegistry' },
    MetricRegistry: { marker: 'MetricRegistry' },
    ConfigRegistry: { marker: 'ConfigRegistry' },
    SpecRegistry: { marker: 'SpecRegistry' },
    AuditLog: { marker: 'AuditLog' },
    LoadTestResult: { marker: 'LoadTestResult' },
  })),
  healthCheck: mongoHealthCheckMock,
  disconnectMongoose: mongoDisconnectMock,
}));
vi.mock('../../../src/adapters/data/mongoose/MongooseRepository.js', () => {
  class FakeMongooseRepository {
    public constructor(
      public readonly model: unknown,
      public readonly entityName: string,
      public readonly logger: unknown,
    ) {}
  }
  return { MongooseRepository: FakeMongooseRepository };
});
vi.mock('../../../src/adapters/data/mongoose/MongooseAgentJobRepository.js', () => {
  class FakeMongooseAgentJobRepository {
    public constructor(
      public readonly model: unknown,
      public readonly logger: unknown,
    ) {}
  }
  return { MongooseAgentJobRepository: FakeMongooseAgentJobRepository };
});
vi.mock('../../../src/adapters/data/mongoose/MongooseJobStepRepository.js', () => {
  class FakeMongooseJobStepRepository {
    public constructor(
      public readonly model: unknown,
      public readonly logger: unknown,
    ) {}
  }
  return { MongooseJobStepRepository: FakeMongooseJobStepRepository };
});
vi.mock('../../../src/adapters/data/mongoose/MongooseDriftEventRepository.js', () => {
  class FakeMongooseDriftEventRepository {
    public constructor(
      public readonly model: unknown,
      public readonly logger: unknown,
    ) {}
  }
  return { MongooseDriftEventRepository: FakeMongooseDriftEventRepository };
});

describe('data adapter factory', () => {
  afterEach(() => {
    prismaHealthCheckMock.mockReset().mockResolvedValue(true);
    prismaDisconnectMock.mockReset().mockResolvedValue(undefined);
    mongoHealthCheckMock.mockReset().mockResolvedValue(true);
    mongoDisconnectMock.mockReset().mockResolvedValue(undefined);
  });

  it("createDataAdapter({ engine: 'postgres', ... }) builds all 10 entity repositories, keyed identically to the mongo branch", async () => {
    const context = await createDataAdapter(buildDataAdapterConfig('postgres'));

    expect(context.engine).toBe('postgres');
    expect(Object.keys(context.repositories).sort()).toEqual(
      [
        'users',
        'agentJobs',
        'jobSteps',
        'toolRegistry',
        'metricRegistry',
        'configRegistry',
        'specRegistry',
        'auditLogs',
        'driftEvents',
        'loadTestResults',
      ].sort(),
    );
    expect(prismaHealthCheckMock).toHaveBeenCalledTimes(1);
  });

  it("createDataAdapter({ engine: 'mongo', ... }) builds all 10 entity repositories", async () => {
    const context = await createDataAdapter(buildDataAdapterConfig('mongo'));

    expect(context.engine).toBe('mongo');
    expect(Object.keys(context.repositories)).toHaveLength(10);
    expect(mongoHealthCheckMock).toHaveBeenCalledTimes(1);
  });

  it('disconnect() delegates to the engine-specific disconnect function', async () => {
    const context = await createDataAdapter(buildDataAdapterConfig('postgres'));
    await context.disconnect();

    expect(prismaDisconnectMock).toHaveBeenCalledTimes(1);
  });

  it('throws ConnectionError when the health check resolves false (database unreachable/unhealthy)', async () => {
    prismaHealthCheckMock.mockResolvedValueOnce(false);

    await expect(createDataAdapter(buildDataAdapterConfig('postgres'))).rejects.toBeInstanceOf(ConnectionError);
  });

  it('throws ConnectionError when the health check rejects', async () => {
    mongoHealthCheckMock.mockRejectedValueOnce(new Error('connection refused'));

    const rejection = createDataAdapter(buildDataAdapterConfig('mongo'));
    await expect(rejection).rejects.toBeInstanceOf(ConnectionError);
    await expect(rejection).rejects.toThrow(/connection refused/);
  });

  it('throws ConnectionError when the health check exceeds healthCheckTimeoutMs', async () => {
    prismaHealthCheckMock.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve(true), 200)),
    );

    const rejection = createDataAdapter(buildDataAdapterConfig('postgres', { healthCheckTimeoutMs: 20 }));
    await expect(rejection).rejects.toBeInstanceOf(ConnectionError);
    await expect(rejection).rejects.toThrow(/timed out/);
  });

  it('rejects an invalid engine value with a descriptive error listing valid options', async () => {
    // Bypasses the DataEngine union type on purpose — a direct caller
    // that skips buildDataAdapterConfig (or getConfig()/envSchema
    // upstream) must still get a clear error, not a silent fallthrough
    // to the mongo branch.
    const invalidConfig = {
      engine: 'mysql',
      poolSize: 10,
      connectionTimeoutMs: 30_000,
      healthCheckTimeoutMs: 5_000,
    } as unknown as Parameters<typeof createDataAdapter>[0];

    await expect(createDataAdapter(invalidConfig)).rejects.toThrow(/Invalid DATA_ENGINE "mysql".*postgres.*mongo/s);
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
