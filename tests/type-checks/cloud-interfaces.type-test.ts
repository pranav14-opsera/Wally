import type {
  ComputeTaskConfig,
  ComputeTaskStatus,
  ICloudComputeService,
  ICloudSecretsService,
  ICloudStorageService,
  SecretMetadata,
  StorageDownloadResult,
  StorageUploadOptions,
} from '../../src/adapters/cloud/interfaces/index.js';

/**
 * Compile-only verification (WO-014 step 9): this file is never executed
 * by any test runner (it lives outside every vitest config's `include`,
 * on purpose — see tsconfig.typecheck.json) — `npm run test:types` (tsc)
 * is the actual check here. A hand-written literal object satisfying
 * each interface, with no casts and no `any`, proves the interface is
 * genuinely implementable as specified, not just internally consistent.
 * If a method signature were wrong, `tsc` would fail to compile this file.
 */

export const mockStorageService: ICloudStorageService = {
  async upload(_key: string, _data: Buffer, _options?: StorageUploadOptions): Promise<void> {
    return undefined;
  },
  async download(key: string): Promise<StorageDownloadResult> {
    return { data: Buffer.from(key) };
  },
  async delete(_key: string): Promise<void> {
    return undefined;
  },
  async list(prefix?: string): Promise<string[]> {
    return prefix ? [`${prefix}example`] : ['example'];
  },
  async exists(_key: string): Promise<boolean> {
    return false;
  },
};

export const mockSecretsService: ICloudSecretsService = {
  async getSecret(_name: string): Promise<string> {
    return 'mock-value';
  },
  async putSecret(_name: string, _value: string): Promise<SecretMetadata> {
    return { version: '1', createdAt: new Date() };
  },
  async rotateSecret(_name: string, _newValue: string): Promise<SecretMetadata> {
    return { version: '2', createdAt: new Date(), rotatedAt: new Date() };
  },
  async deleteSecret(_name: string): Promise<void> {
    return undefined;
  },
};

export const mockComputeService: ICloudComputeService = {
  async runTask(_config: ComputeTaskConfig): Promise<string> {
    return 'mock-task-id';
  },
  async getTaskStatus(taskId: string): Promise<ComputeTaskStatus> {
    return { taskId, state: 'pending' };
  },
  async stopTask(_taskId: string): Promise<void> {
    return undefined;
  },
};
