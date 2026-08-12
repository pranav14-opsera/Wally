import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { S3Client } from '@aws-sdk/client-s3';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { S3StorageAdapter } from '../../src/adapters/cloud/aws/S3StorageAdapter.js';
import { AzureStorageStub } from '../../src/adapters/cloud/azure/AzureStorageStub.js';
import { GcpStorageStub } from '../../src/adapters/cloud/gcp/GcpStorageStub.js';
import type { ICloudStorageService, StorageError } from '../../src/adapters/cloud/interfaces/index.js';
import { ProviderNotImplementedError } from '../../src/adapters/cloud/interfaces/index.js';
import { FilesystemStorageAdapter } from '../../src/adapters/cloud/local/FilesystemStorageAdapter.js';

const silentLogger = pino({ level: 'silent' });

/**
 * WO-022: the same test logic runs against every ICloudStorageService
 * implementation — a passing adapter must satisfy every assertion here,
 * with no per-adapter branching inside the suite itself. Call sites (below)
 * supply the adapter instance and an `expectNotImplemented` flag for
 * provider stubs that intentionally reject every call.
 */
export function runStorageContractTests(
  name: string,
  createAdapter: () => ICloudStorageService | Promise<ICloudStorageService>,
  options: { expectNotImplemented?: boolean; afterEachCleanup?: () => Promise<void> } = {},
): void {
  describe(`ICloudStorageService contract: ${name}`, () => {
    let adapter: ICloudStorageService;

    beforeEach(async () => {
      adapter = await createAdapter();
    });

    afterEach(async () => {
      await options.afterEachCleanup?.();
    });

    if (options.expectNotImplemented) {
      it.each([
        ['upload', () => adapter.upload('k', Buffer.from('d'))],
        ['download', () => adapter.download('k')],
        ['delete', () => adapter.delete('k')],
        ['list', () => adapter.list()],
        ['exists', () => adapter.exists('k')],
      ] as const)('%s() throws ProviderNotImplementedError', async (_method, call) => {
        await expect(call()).rejects.toBeInstanceOf(ProviderNotImplementedError);
      });
      return;
    }

    it('round-trips upload -> exists -> download -> list -> delete -> exists', async () => {
      const key = `contract/${name.replace(/\s+/g, '-')}/object-1.json`;
      const payload = Buffer.from(JSON.stringify({ ok: true, adapter: name }));

      await adapter.upload(key, payload, { contentType: 'application/json', metadata: { origin: 'contract-test' } });

      expect(await adapter.exists(key)).toBe(true);

      const downloaded = await adapter.download(key);
      expect(downloaded.data.equals(payload)).toBe(true);
      expect(downloaded.contentType).toBe('application/json');
      expect(downloaded.metadata).toMatchObject({ origin: 'contract-test' });

      const keys = await adapter.list(`contract/${name.replace(/\s+/g, '-')}/`);
      expect(keys).toContain(key);

      await adapter.delete(key);
      expect(await adapter.exists(key)).toBe(false);
    });

    it('download() rejects a missing key with StorageError code NOT_FOUND', async () => {
      const key = `contract/${name.replace(/\s+/g, '-')}/never-uploaded.json`;
      await expect(adapter.download(key)).rejects.toMatchObject({ code: 'NOT_FOUND' } satisfies Partial<StorageError>);
    });

    it('exists() returns false for a missing key rather than throwing', async () => {
      await expect(adapter.exists(`contract/${name.replace(/\s+/g, '-')}/never-uploaded-2.json`)).resolves.toBe(false);
    });

    it('delete() is idempotent — deleting a missing key does not throw', async () => {
      await expect(adapter.delete(`contract/${name.replace(/\s+/g, '-')}/never-uploaded-3.json`)).resolves.not.toThrow();
    });

    it('list() with no prefix includes keys uploaded outside any prefix', async () => {
      const key = `contract-flat-${name.replace(/\s+/g, '-')}.txt`;
      await adapter.upload(key, Buffer.from('flat'));
      try {
        expect(await adapter.list()).toContain(key);
      } finally {
        await adapter.delete(key);
      }
    });
  });
}

/** In-memory fake S3Client backing store — implements just enough of the SDK v3 command surface for a real round-trip through S3StorageAdapter's own code paths (no mocking inside S3StorageAdapter itself). */
function createFakeS3Client(): S3Client {
  const objects = new Map<string, { data: Buffer; metadata?: Record<string, string>; contentType?: string }>();

  const send = vi.fn(async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      const { Key, Body, Metadata, ContentType } = command.input;
      objects.set(Key!, { data: Buffer.from(Body as Buffer), metadata: Metadata, contentType: ContentType });
      return { $metadata: { httpStatusCode: 200 } };
    }
    if (command instanceof GetObjectCommand) {
      const object = objects.get(command.input.Key!);
      if (!object) {
        throw Object.assign(new Error('The specified key does not exist.'), {
          name: 'NoSuchKey',
          $metadata: { httpStatusCode: 404 },
        });
      }
      return {
        $metadata: { httpStatusCode: 200 },
        Body: { transformToByteArray: async () => new Uint8Array(object.data) },
        Metadata: object.metadata,
        ContentType: object.contentType,
      };
    }
    if (command instanceof HeadObjectCommand) {
      if (!objects.has(command.input.Key!)) {
        throw Object.assign(new Error('Not Found'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
      }
      return { $metadata: { httpStatusCode: 200 } };
    }
    if (command instanceof DeleteObjectCommand) {
      objects.delete(command.input.Key!);
      return { $metadata: { httpStatusCode: 204 } };
    }
    if (command instanceof ListObjectsV2Command) {
      const prefix = command.input.Prefix ?? '';
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix));
      return { $metadata: { httpStatusCode: 200 }, Contents: keys.map((Key) => ({ Key })), IsTruncated: false };
    }
    throw new Error(`createFakeS3Client: unhandled command ${(command as { constructor: { name: string } }).constructor.name}`);
  });

  return { send } as unknown as S3Client;
}

{
  let localBaseDir: string | undefined;
  runStorageContractTests(
    'local (FilesystemStorageAdapter)',
    async () => {
      localBaseDir = await mkdtemp(join(tmpdir(), 'wally-storage-contract-'));
      return new FilesystemStorageAdapter(localBaseDir, silentLogger);
    },
    { afterEachCleanup: async () => rm(localBaseDir!, { recursive: true, force: true }) },
  );
}

runStorageContractTests(
  'aws (S3StorageAdapter, mocked SDK)',
  () => new S3StorageAdapter(createFakeS3Client(), 'wally-contract-test-bucket', silentLogger),
);

// SecretsManagerAdapter/ECSComputeRunner are covered in their own contract
// files once WO-019/WO-020 land; S3StorageAdapter (WO-018) already exists,
// so this is the only "aws (mocked SDK)" branch runnable today.

runStorageContractTests('gcp (GcpStorageStub)', () => new GcpStorageStub(), { expectNotImplemented: true });
runStorageContractTests('azure (AzureStorageStub)', () => new AzureStorageStub(), { expectNotImplemented: true });
