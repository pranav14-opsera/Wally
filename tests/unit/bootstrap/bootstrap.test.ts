import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// WO-013: bootstrap() now calls createDataAdapter(), which performs a real
// connection health check (AC5) — mock the same six dynamically-`import()`ed
// modules factory.ts loads (see tests/unit/adapters/factory.test.ts for the
// identical setup, duplicated here rather than shared since vi.mock() must
// be hoisted within the file that needs the interception) so bootstrap()
// can succeed in these unit tests without a real Postgres/Mongo instance.
vi.mock('../../../src/adapters/data/prisma/prisma-client.js', () => ({
  getPrismaClient: vi.fn(() => ({ marker: 'fake-prisma-client' })),
  healthCheck: vi.fn(async () => true),
  disconnectPrismaClient: vi.fn(async () => undefined),
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
    User: {},
    AgentJob: {},
    ToolRegistry: {},
    MetricRegistry: {},
    ConfigRegistry: {},
    SpecRegistry: {},
    AuditLog: {},
    LoadTestResult: {},
  })),
  healthCheck: vi.fn(async () => true),
  disconnectMongoose: vi.fn(async () => undefined),
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
    expect(container.dataAdapter).toBeDefined();
    expect(container.dataAdapter.engine).toBe('postgres');
    expect(Object.keys(container.dataAdapter.repositories)).toHaveLength(10);
    expect(typeof container.dataAdapter.disconnect).toBe('function');
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

  it('resolves all three adapters via their stub implementations when config selects CLOUD_PROVIDER=gcp (WO-021/WO-022)', async () => {
    // CLOUD_PROVIDER=gcp passes config validation and now has all three
    // cloud adapters registered (GcpStorageStub/GcpSecretsStub/
    // GcpComputeStub, WO-021) — bootstrap() itself only *constructs* the
    // adapters and calls their optional `init()` hooks, neither of which
    // any stub method touches, so bootstrap succeeds even though every
    // other method on these adapters throws ProviderNotImplementedError
    // if actually called later.
    process.env = {
      ...ORIGINAL_ENV,
      ...VALID_ENV,
      CLOUD_PROVIDER: 'gcp',
    };
    const { bootstrap } = await import('../../../src/bootstrap.js');

    const container = await bootstrap();

    expect(container.cloudStorage.constructor.name).toBe('GcpStorageStub');
    expect(container.cloudSecrets.constructor.name).toBe('GcpSecretsStub');
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
