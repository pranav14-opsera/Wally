// Relative import, not the @config alias — see the note in
// src/logging/logger.ts for why cross-module imports in src/ use real
// relative paths rather than tsconfig path aliases.
import { getConfig } from '../../config/index.js';
import type { CloudProvider, ComputeRunner } from '../../config/schema.js';
import { createLogger } from '../../logging/index.js';
import { AdapterNotRegisteredError } from '../errors.js';
import type { ICloudComputeService, ICloudSecretsService, ICloudStorageService } from './interfaces/index.js';
import { FilesystemStorageAdapter } from './local/FilesystemStorageAdapter.js';
import { StubComputeAdapter } from './stubs/stub-compute-adapter.js';
import { StubSecretsAdapter } from './stubs/stub-secrets-adapter.js';

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

export const cloudSecretsRegistry = new AdapterRegistry<ICloudSecretsService>('cloud secrets');
cloudSecretsRegistry.register('local', () => new StubSecretsAdapter());

export const cloudComputeRegistry = new AdapterRegistry<ICloudComputeService>('cloud compute');
cloudComputeRegistry.register('local', () => new StubComputeAdapter());

export function createCloudStorageAdapter(provider: CloudProvider): ICloudStorageService {
  return cloudStorageRegistry.resolve(provider);
}

export function createCloudSecretsAdapter(provider: CloudProvider): ICloudSecretsService {
  return cloudSecretsRegistry.resolve(provider);
}

export function createCloudComputeAdapter(runner: ComputeRunner): ICloudComputeService {
  return cloudComputeRegistry.resolve(runner);
}
