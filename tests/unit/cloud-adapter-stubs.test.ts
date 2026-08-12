import { describe, expect, it } from 'vitest';

import { ProviderNotImplementedError } from '../../src/adapters/cloud/interfaces/index.js';
import { AzureComputeStub } from '../../src/adapters/cloud/azure/AzureComputeStub.js';
import { AzureSecretsStub } from '../../src/adapters/cloud/azure/AzureSecretsStub.js';
import { AzureStorageStub } from '../../src/adapters/cloud/azure/AzureStorageStub.js';
import { GcpComputeStub } from '../../src/adapters/cloud/gcp/GcpComputeStub.js';
import { GcpSecretsStub } from '../../src/adapters/cloud/gcp/GcpSecretsStub.js';
import { GcpStorageStub } from '../../src/adapters/cloud/gcp/GcpStorageStub.js';

interface StubCase {
  name: string;
  provider: 'gcp' | 'azure';
  backingService: string;
  instance: Record<string, (...args: never[]) => Promise<unknown>>;
  methods: Array<{ method: string; args: unknown[] }>;
}

const cases: StubCase[] = [
  {
    name: 'GcpStorageStub',
    provider: 'gcp',
    backingService: 'Google Cloud Storage',
    instance: new GcpStorageStub() as unknown as StubCase['instance'],
    methods: [
      { method: 'upload', args: ['key', Buffer.from('data')] },
      { method: 'download', args: ['key'] },
      { method: 'delete', args: ['key'] },
      { method: 'list', args: [undefined] },
      { method: 'exists', args: ['key'] },
    ],
  },
  {
    name: 'GcpSecretsStub',
    provider: 'gcp',
    backingService: 'Google Secret Manager',
    instance: new GcpSecretsStub() as unknown as StubCase['instance'],
    methods: [
      { method: 'getSecret', args: ['name'] },
      { method: 'putSecret', args: ['name', 'value'] },
      { method: 'rotateSecret', args: ['name', 'new-value'] },
      { method: 'deleteSecret', args: ['name'] },
    ],
  },
  {
    name: 'GcpComputeStub',
    provider: 'gcp',
    backingService: 'Google Cloud Run Jobs',
    instance: new GcpComputeStub() as unknown as StubCase['instance'],
    methods: [
      { method: 'runTask', args: [{ command: 'echo hi' }] },
      { method: 'getTaskStatus', args: ['task-id'] },
      { method: 'stopTask', args: ['task-id'] },
    ],
  },
  {
    name: 'AzureStorageStub',
    provider: 'azure',
    backingService: 'Azure Blob Storage',
    instance: new AzureStorageStub() as unknown as StubCase['instance'],
    methods: [
      { method: 'upload', args: ['key', Buffer.from('data')] },
      { method: 'download', args: ['key'] },
      { method: 'delete', args: ['key'] },
      { method: 'list', args: [undefined] },
      { method: 'exists', args: ['key'] },
    ],
  },
  {
    name: 'AzureSecretsStub',
    provider: 'azure',
    backingService: 'Azure Key Vault',
    instance: new AzureSecretsStub() as unknown as StubCase['instance'],
    methods: [
      { method: 'getSecret', args: ['name'] },
      { method: 'putSecret', args: ['name', 'value'] },
      { method: 'rotateSecret', args: ['name', 'new-value'] },
      { method: 'deleteSecret', args: ['name'] },
    ],
  },
  {
    name: 'AzureComputeStub',
    provider: 'azure',
    backingService: 'Azure Container Instances',
    instance: new AzureComputeStub() as unknown as StubCase['instance'],
    methods: [
      { method: 'runTask', args: [{ command: 'echo hi' }] },
      { method: 'getTaskStatus', args: ['task-id'] },
      { method: 'stopTask', args: ['task-id'] },
    ],
  },
];

describe('GCP/Azure cloud adapter stubs (WO-021)', () => {
  for (const stubCase of cases) {
    describe(stubCase.name, () => {
      for (const { method, args } of stubCase.methods) {
        it(`${method}() throws ProviderNotImplementedError with provider="${stubCase.provider}", operation="${method}", backingService="${stubCase.backingService}"`, async () => {
          let thrown: ProviderNotImplementedError | undefined;
          try {
            await stubCase.instance[method]!(...(args as never[]));
            expect.unreachable(`${stubCase.name}.${method}() should have thrown`);
          } catch (error) {
            thrown = error as ProviderNotImplementedError;
          }

          expect(thrown).toBeInstanceOf(ProviderNotImplementedError);
          expect(thrown?.provider).toBe(stubCase.provider);
          expect(thrown?.operation).toBe(method);
          expect(thrown?.backingService).toBe(stubCase.backingService);
          expect(thrown?.message).toContain(stubCase.provider);
          expect(thrown?.message).toContain(method);
          expect(thrown?.message).toContain(stubCase.backingService);
          expect(thrown?.message).toContain('stub');
        });
      }
    });
  }
});
