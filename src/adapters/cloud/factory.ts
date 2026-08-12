import { S3Client } from '@aws-sdk/client-s3';

// Relative import, not the @config alias — see the note in
// src/logging/logger.ts for why cross-module imports in src/ use real
// relative paths rather than tsconfig path aliases.
import { getConfig } from '../../config/index.js';
import type { CloudProvider, ComputeRunner } from '../../config/schema.js';
import { createLogger } from '../../logging/index.js';
import { AdapterNotRegisteredError } from '../errors.js';
import { S3StorageAdapter } from './aws/S3StorageAdapter.js';
import { AzureComputeStub } from './azure/AzureComputeStub.js';
import { AzureSecretsStub } from './azure/AzureSecretsStub.js';
import { AzureStorageStub } from './azure/AzureStorageStub.js';
import { GcpComputeStub } from './gcp/GcpComputeStub.js';
import { GcpSecretsStub } from './gcp/GcpSecretsStub.js';
import { GcpStorageStub } from './gcp/GcpStorageStub.js';
import type { ICloudComputeService, ICloudSecretsService, ICloudStorageService } from './interfaces/index.js';
import { CloudAdapterError } from './interfaces/index.js';
import { FilesystemStorageAdapter } from './local/FilesystemStorageAdapter.js';
import { LocalComputeRunner } from './local/LocalComputeRunner.js';
import { LocalSecretsAdapter } from './local/LocalSecretsAdapter.js';

/**
 * Map-based registry so new provider implementations can be registered
 * (here or from a test) without modifying this factory's code — the
 * zero-hardcoding principle applies to the factory itself, not just the
 * env-var-driven selection.
 */
export class AdapterRegistry<TAdapter> {
  private readonly factories = new Map<string, () => TAdapter>();

  public constructor(private readonly category: string) {}

  public register(key: string, factory: () => TAdapter): void {
    this.factories.set(key, factory);
  }

  public resolve(key: string): TAdapter {
    const factory = this.factories.get(key);
    if (!factory) {
      throw new AdapterNotRegisteredError(this.category, key, [...this.factories.keys()]);
    }
    return factory();
  }
}

export const cloudStorageRegistry = new AdapterRegistry<ICloudStorageService>('cloud storage');
// Real implementation, not a stub — the local-first principle requires
// CLOUD_PROVIDER=local to exercise production-grade code paths. getConfig()
// is called lazily inside this closure (deferred until resolve() actually
// runs during bootstrap), not at module load, since config validation must
// happen first.
cloudStorageRegistry.register(
  'local',
  () => new FilesystemStorageAdapter(getConfig().STORAGE_LOCAL_PATH, createLogger('FilesystemStorageAdapter')),
);
// Real implementation (WO-018) — S3Client uses the SDK's default
// credential provider chain (IAM role / env vars / shared credentials
// file); AWS_REGION/S3_BUCKET_NAME are validated as required by
// envSchema whenever CLOUD_PROVIDER=aws, but re-checked here (same
// pattern as prisma-client.ts's POSTGRES_* guard) rather than asserted,
// since this closure's type only sees them as optional.
cloudStorageRegistry.register('aws', () => {
  const { AWS_REGION, S3_BUCKET_NAME } = getConfig();
  if (!AWS_REGION || !S3_BUCKET_NAME) {
    throw new Error('S3StorageAdapter requires AWS_REGION and S3_BUCKET_NAME to be set when CLOUD_PROVIDER=aws.');
  }
  return new S3StorageAdapter(new S3Client({ region: AWS_REGION }), S3_BUCKET_NAME, createLogger('S3StorageAdapter'));
});
// Stubs (WO-021) — every method throws ProviderNotImplementedError.
cloudStorageRegistry.register('gcp', () => new GcpStorageStub());
cloudStorageRegistry.register('azure', () => new AzureStorageStub());

export const cloudSecretsRegistry = new AdapterRegistry<ICloudSecretsService>('cloud secrets');
// Real implementation (WO-016), not a stub — same local-first rationale as
// cloudStorageRegistry above.
cloudSecretsRegistry.register(
  'local',
  () => new LocalSecretsAdapter(getConfig().SECRETS_LOCAL_PATH, 'LOCAL_SECRETS_MASTER_KEY', createLogger('LocalSecretsAdapter')),
);
// No 'aws' entry yet — SecretsManagerAdapter (WO-019) is a separate,
// still-in-progress work order. Resolving 'aws' here throws
// AdapterNotRegisteredError (a clear, already-designed-for failure mode —
// see that error's own doc comment) until WO-019 registers it; no change
// to this factory will be needed when it lands.
cloudSecretsRegistry.register('gcp', () => new GcpSecretsStub());
cloudSecretsRegistry.register('azure', () => new AzureSecretsStub());

export const cloudComputeRegistry = new AdapterRegistry<ICloudComputeService>('cloud compute');
// Real implementation (WO-017), not a stub — same local-first rationale as
// cloudStorageRegistry above.
cloudComputeRegistry.register(
  'local',
  () =>
    new LocalComputeRunner(
      getConfig().K6_BINARY_PATH,
      getConfig().COMPUTE_TASK_TIMEOUT_MS,
      getConfig().COMPUTE_GRACE_PERIOD_MS,
      getConfig().COMPUTE_TASK_RETENTION_MS,
      createLogger('LocalComputeRunner'),
    ),
);
// No 'aws' entry yet — ECSComputeRunner (WO-020) is a separate, not yet
// started work order. Same AdapterNotRegisteredError rationale as
// cloudSecretsRegistry's 'aws' gap above.
cloudComputeRegistry.register('gcp', () => new GcpComputeStub());
cloudComputeRegistry.register('azure', () => new AzureComputeStub());

export function createCloudStorageAdapter(provider: CloudProvider): ICloudStorageService {
  return cloudStorageRegistry.resolve(provider);
}

export function createCloudSecretsAdapter(provider: CloudProvider): ICloudSecretsService {
  return cloudSecretsRegistry.resolve(provider);
}

export function createCloudComputeAdapter(runner: ComputeRunner): ICloudComputeService {
  return cloudComputeRegistry.resolve(runner);
}

export interface CloudAdapters {
  storage: ICloudStorageService;
  secrets: ICloudSecretsService;
  compute: ICloudComputeService;
}

export interface CloudAdapterConfig {
  cloudProvider: CloudProvider;
  computeRunner: ComputeRunner;
}

const VALID_CLOUD_PROVIDERS: readonly CloudProvider[] = ['local', 'aws', 'gcp', 'azure'];

function resolveCloudProvider(value: unknown): CloudProvider {
  if (typeof value !== 'string' || value.trim() === '' || !VALID_CLOUD_PROVIDERS.includes(value as CloudProvider)) {
    throw new CloudAdapterError(
      `Invalid CLOUD_PROVIDER: ${JSON.stringify(value)}. Valid options: ${VALID_CLOUD_PROVIDERS.join(', ')}.`,
      'CONFIGURATION_ERROR',
      typeof value === 'string' && value.trim() !== '' ? value : '(unset)',
      'createCloudAdapters',
    );
  }
  return value as CloudProvider;
}

/**
 * Resolves which provider key backs *compute* specifically —
 * `COMPUTE_RUNNER` overrides `CLOUD_PROVIDER` independently, since a
 * deployment may want cloud storage/secrets but still run k6 locally (or
 * vice versa is nonsensical, hence the ambiguous-config error below).
 */
function resolveComputeProvider(cloudProvider: CloudProvider, computeRunner: ComputeRunner): CloudProvider {
  if (computeRunner === 'local') {
    return 'local';
  }
  // computeRunner === 'cloud'
  if (cloudProvider === 'local') {
    throw new CloudAdapterError(
      'COMPUTE_RUNNER=cloud requires a cloud CLOUD_PROVIDER (aws, gcp, or azure) — CLOUD_PROVIDER=local has no ' +
        'cloud compute backend to run tasks on. Either set COMPUTE_RUNNER=local or choose a cloud CLOUD_PROVIDER.',
      'CONFIGURATION_ERROR',
      cloudProvider,
      'createCloudAdapters',
    );
  }
  return cloudProvider;
}

/**
 * The composition root's single entry point for cloud adapter selection
 * (WO-022) — reads `CLOUD_PROVIDER`/`COMPUTE_RUNNER` from config (or an
 * explicit override, mainly for tests) and returns fully wired storage,
 * secrets, and compute adapters. This function, together with the
 * per-category `register()` calls above, is the ONLY place in the
 * codebase that references concrete adapter class names — every other
 * consumer depends on `ICloudStorageService`/`ICloudSecretsService`/
 * `ICloudComputeService` only.
 *
 * Each call returns fresh adapter instances (the registries' factory
 * closures construct a new instance per `resolve()` call) — there is no
 * module-level singleton to leak state between callers or tests.
 */
export function createCloudAdapters(config?: Partial<CloudAdapterConfig>): CloudAdapters {
  const appConfig = getConfig();
  const cloudProvider = resolveCloudProvider(config?.cloudProvider ?? appConfig.CLOUD_PROVIDER);
  const computeRunner = config?.computeRunner ?? appConfig.COMPUTE_RUNNER;
  const computeProvider = resolveComputeProvider(cloudProvider, computeRunner);

  return {
    storage: cloudStorageRegistry.resolve(cloudProvider),
    secrets: cloudSecretsRegistry.resolve(cloudProvider),
    compute: cloudComputeRegistry.resolve(computeProvider),
  };
}
