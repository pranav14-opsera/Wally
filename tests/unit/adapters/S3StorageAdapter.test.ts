import type { S3Client } from '@aws-sdk/client-s3';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageError } from '../../../src/adapters/cloud/index.js';
import { S3StorageAdapter } from '../../../src/adapters/cloud/aws/S3StorageAdapter.js';
import {
  mockAccessDeniedError,
  mockCredentialsProviderError,
  mockDeleteObjectResponse,
  mockGetObjectResponse,
  mockHeadObjectResponse,
  mockListObjectsV2Response,
  mockNoSuchBucketError,
  mockNoSuchKeyError,
  mockNotFoundError,
  mockPutObjectResponse,
  mockRequestTimeoutError,
  mockUnknownServiceError,
} from '../../fixtures/aws/s3-responses.js';

const silentLogger = pino({ level: 'silent' });
const BUCKET = 'wally-test-bucket';

let sendMock: ReturnType<typeof vi.fn>;
let adapter: S3StorageAdapter;

beforeEach(() => {
  sendMock = vi.fn();
  const fakeClient = { send: sendMock } as unknown as S3Client;
  adapter = new S3StorageAdapter(fakeClient, BUCKET, silentLogger);
});

describe('S3StorageAdapter', () => {
  describe('upload', () => {
    it('sends a PutObjectCommand with body, content type, and metadata', async () => {
      sendMock.mockResolvedValueOnce(mockPutObjectResponse());

      await adapter.upload('reports/report.json', Buffer.from('{"ok":true}'), {
        contentType: 'application/json',
        metadata: { jobId: 'job-1' },
      });

      expect(sendMock).toHaveBeenCalledTimes(1);
      const command = sendMock.mock.calls[0]![0] as PutObjectCommand;
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input).toMatchObject({
        Bucket: BUCKET,
        Key: 'reports/report.json',
        ContentType: 'application/json',
        Metadata: { jobId: 'job-1' },
      });
    });

    it('sets ServerSideEncryption when options.encryption is true', async () => {
      sendMock.mockResolvedValueOnce(mockPutObjectResponse());
      await adapter.upload('key', Buffer.from('data'), { encryption: true });

      const command = sendMock.mock.calls[0]![0] as PutObjectCommand;
      expect(command.input.ServerSideEncryption).toBe('AES256');
    });

    it('rejects an object exceeding the 5GB single-PUT limit without calling S3', async () => {
      const oversized = { length: 5 * 1024 * 1024 * 1024 + 1 } as Buffer;
      await expect(adapter.upload('huge-file', oversized)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      expect(sendMock).not.toHaveBeenCalled();
    });
  });

  describe('download', () => {
    it('returns the body as a Buffer with metadata and contentType', async () => {
      sendMock.mockResolvedValueOnce(
        mockGetObjectResponse('{"ok":true}', { metadata: { jobId: 'job-1' }, contentType: 'application/json' }),
      );

      const result = await adapter.download('reports/report.json');
      expect(result.data.toString()).toBe('{"ok":true}');
      expect(result.metadata).toEqual({ jobId: 'job-1' });
      expect(result.contentType).toBe('application/json');

      const command = sendMock.mock.calls[0]![0] as GetObjectCommand;
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect(command.input).toMatchObject({ Bucket: BUCKET, Key: 'reports/report.json' });
    });

    it('throws a StorageError with NOT_FOUND for a missing key (NoSuchKey)', async () => {
      sendMock.mockRejectedValueOnce(mockNoSuchKeyError());

      let thrown: StorageError | undefined;
      try {
        await adapter.download('missing.txt');
        expect.unreachable();
      } catch (error) {
        thrown = error as StorageError;
      }

      expect(thrown).toBeInstanceOf(StorageError);
      expect(thrown?.code).toBe('NOT_FOUND');
      expect(thrown?.key).toBe('missing.txt');
      expect(thrown?.bucket).toBe(BUCKET);
    });

    it('maps NoSuchBucket to CONFIGURATION_ERROR', async () => {
      sendMock.mockRejectedValueOnce(mockNoSuchBucketError());
      await expect(adapter.download('key')).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    });

    it('maps a missing-credentials error to CONFIGURATION_ERROR', async () => {
      sendMock.mockRejectedValueOnce(mockCredentialsProviderError());
      await expect(adapter.download('key')).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    });

    it('maps AccessDenied to PERMISSION_DENIED', async () => {
      sendMock.mockRejectedValueOnce(mockAccessDeniedError());
      await expect(adapter.download('key')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('maps RequestTimeout to NETWORK_ERROR', async () => {
      sendMock.mockRejectedValueOnce(mockRequestTimeoutError());
      await expect(adapter.download('key')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    });

    it('maps an unrecognized AWS error to PROVIDER_ERROR', async () => {
      sendMock.mockRejectedValueOnce(mockUnknownServiceError());
      await expect(adapter.download('key')).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    });

    it('never includes the object body/plaintext in a thrown error message', async () => {
      sendMock.mockRejectedValueOnce(mockNoSuchKeyError());
      try {
        await adapter.download('secret-report.json');
        expect.unreachable();
      } catch (error) {
        expect(JSON.stringify((error as StorageError).toJSON())).not.toContain('body');
      }
    });
  });

  describe('delete', () => {
    it('sends a DeleteObjectCommand and does not throw (idempotent — S3 itself does not error on a missing key)', async () => {
      sendMock.mockResolvedValueOnce(mockDeleteObjectResponse());
      await expect(adapter.delete('key')).resolves.toBeUndefined();

      const command = sendMock.mock.calls[0]![0] as DeleteObjectCommand;
      expect(command).toBeInstanceOf(DeleteObjectCommand);
      expect(command.input).toMatchObject({ Bucket: BUCKET, Key: 'key' });
    });

    it('propagates a genuine AWS error (e.g. AccessDenied) as a StorageError', async () => {
      sendMock.mockRejectedValueOnce(mockAccessDeniedError());
      await expect(adapter.delete('key')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });
  });

  describe('list', () => {
    it('returns keys from a single page', async () => {
      sendMock.mockResolvedValueOnce(mockListObjectsV2Response(['a.txt', 'b.txt']));
      const keys = await adapter.list();
      expect(keys).toEqual(['a.txt', 'b.txt']);

      const command = sendMock.mock.calls[0]![0] as ListObjectsV2Command;
      expect(command).toBeInstanceOf(ListObjectsV2Command);
    });

    it('passes prefix through to the command', async () => {
      sendMock.mockResolvedValueOnce(mockListObjectsV2Response(['reports/a.txt']));
      await adapter.list('reports/');

      const command = sendMock.mock.calls[0]![0] as ListObjectsV2Command;
      expect(command.input.Prefix).toBe('reports/');
    });

    it('paginates across multiple pages using ContinuationToken', async () => {
      sendMock
        .mockResolvedValueOnce(mockListObjectsV2Response(['a.txt'], { isTruncated: true, nextContinuationToken: 'token-1' }))
        .mockResolvedValueOnce(mockListObjectsV2Response(['b.txt'], { isTruncated: false }));

      const keys = await adapter.list();
      expect(keys).toEqual(['a.txt', 'b.txt']);
      expect(sendMock).toHaveBeenCalledTimes(2);

      const secondCommand = sendMock.mock.calls[1]![0] as ListObjectsV2Command;
      expect(secondCommand.input.ContinuationToken).toBe('token-1');
    });

    it('returns an empty array when there are no matching keys, without throwing', async () => {
      sendMock.mockResolvedValueOnce(mockListObjectsV2Response([]));
      await expect(adapter.list('nonexistent-prefix/')).resolves.toEqual([]);
    });
  });

  describe('exists', () => {
    it('returns true on a successful HeadObjectCommand', async () => {
      sendMock.mockResolvedValueOnce(mockHeadObjectResponse());
      await expect(adapter.exists('key')).resolves.toBe(true);

      const command = sendMock.mock.calls[0]![0] as HeadObjectCommand;
      expect(command).toBeInstanceOf(HeadObjectCommand);
    });

    it('returns false (without throwing) when HeadObjectCommand throws NotFound', async () => {
      sendMock.mockRejectedValueOnce(mockNotFoundError());
      await expect(adapter.exists('missing')).resolves.toBe(false);
    });

    it('returns false when HeadObjectCommand throws NoSuchKey', async () => {
      sendMock.mockRejectedValueOnce(mockNoSuchKeyError());
      await expect(adapter.exists('missing')).resolves.toBe(false);
    });

    it('still throws for a genuine error (e.g. AccessDenied), not swallowed as false', async () => {
      sendMock.mockRejectedValueOnce(mockAccessDeniedError());
      await expect(adapter.exists('key')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });
  });
});
