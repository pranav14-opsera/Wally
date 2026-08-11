import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import type { Logger } from 'pino';

import type {
  CloudErrorCode,
  ICloudStorageService,
  StorageDownloadResult,
  StorageUploadOptions,
} from '../interfaces/index.js';
import { StorageError } from '../interfaces/index.js';

// A single PutObjectCommand call is capped at 5GB by S3 itself; anything
// larger needs a multipart upload, which this initial implementation
// doesn't yet support (documented limit, per the WO's edge-case list).
const MAX_SINGLE_PUT_BYTES = 5 * 1024 * 1024 * 1024;

/**
 * Production ICloudStorageService backed by AWS S3 (AWS SDK v3, modular
 * imports only, per the WO's constraint) — selected when
 * CLOUD_PROVIDER=aws. Behaves identically to FilesystemStorageAdapter for
 * every method (same error semantics via the shared StorageError codes,
 * same idempotent-delete contract) so both are conformance-tested as
 * interchangeable (WO-022).
 *
 * The `S3Client` is injected, not constructed here — the factory builds
 * it from `AWS_REGION` using the SDK's default credential provider chain
 * (IAM role / env vars / shared credentials file), and tests inject a
 * mocked client.
 */
export class S3StorageAdapter implements ICloudStorageService {
  public constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly logger: Logger,
  ) {}

  public async upload(key: string, data: Buffer, options?: StorageUploadOptions): Promise<void> {
    if (data.length > MAX_SINGLE_PUT_BYTES) {
      throw new StorageError(
        `Object exceeds the ${MAX_SINGLE_PUT_BYTES} byte single-PUT limit (${data.length} bytes) — ` +
          'multipart upload is not yet implemented for S3StorageAdapter.',
        'INVALID_ARGUMENT',
        'aws',
        'upload',
        key,
        this.bucket,
      );
    }

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: data,
          ContentType: options?.contentType,
          Metadata: options?.metadata,
          ...(options?.encryption ? { ServerSideEncryption: 'AES256' } : {}),
        }),
      );
      this.logger.info({ key, bucket: this.bucket, bytes: data.length }, 'Uploaded storage object to S3');
    } catch (error) {
      throw this.mapAwsError(error, key, 'upload');
    }
  }

  public async download(key: string): Promise<StorageDownloadResult> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      // Body's transformToByteArray() (SdkStreamMixin) works across every
      // JS runtime the SDK targets (Node Readable, web ReadableStream,
      // Blob) — a manual stream-concat would only handle the Node case.
      const data = response.Body ? Buffer.from(await response.Body.transformToByteArray()) : Buffer.alloc(0);
      return { data, metadata: response.Metadata, contentType: response.ContentType };
    } catch (error) {
      throw this.mapAwsError(error, key, 'download');
    }
  }

  public async delete(key: string): Promise<void> {
    try {
      // DeleteObject is idempotent in S3 itself — it returns success even
      // when the key doesn't exist, so no explicit not-found handling is
      // needed here to satisfy the AC's idempotent-delete requirement.
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      this.logger.info({ key, bucket: this.bucket }, 'Deleted storage object from S3');
    } catch (error) {
      throw this.mapAwsError(error, key, 'delete');
    }
  }

  public async list(prefix?: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;

    try {
      do {
        const response = await this.client.send(
          new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: continuationToken }),
        );
        for (const object of response.Contents ?? []) {
          if (object.Key) {
            keys.push(object.Key);
          }
        }
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken);

      return keys;
    } catch (error) {
      throw this.mapAwsError(error, prefix ?? '', 'list');
    }
  }

  public async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return false;
      }
      throw this.mapAwsError(error, key, 'exists');
    }
  }

  // HeadObject's 404 surfaces as error.name === 'NotFound' (not
  // 'NoSuchKey', which is GetObject's name for the identical condition) —
  // a well-known AWS SDK inconsistency, checked for explicitly here.
  private isNotFoundError(error: unknown): boolean {
    const name = (error as { name?: string } | undefined)?.name;
    return name === 'NotFound' || name === 'NoSuchKey';
  }

  private mapAwsError(error: unknown, key: string, operation: string): StorageError {
    const name = (error as { name?: string } | undefined)?.name ?? '';
    const statusCode = (error as { $metadata?: { httpStatusCode?: number } } | undefined)?.$metadata
      ?.httpStatusCode;

    let code: CloudErrorCode;
    let message: string;

    if (name === 'NoSuchBucket') {
      // Checked before the generic not-found branch below — NoSuchBucket
      // is also a 404, but a missing bucket is a configuration problem,
      // not "this object doesn't exist" (S3StorageAdapter.isNotFoundError
      // deliberately only matches the two specific missing-*object* names,
      // never a bare status code, for exactly this reason).
      code = 'CONFIGURATION_ERROR';
      message = `S3 bucket "${this.bucket}" does not exist or is not accessible`;
    } else if (this.isNotFoundError(error)) {
      code = 'NOT_FOUND';
      message = `S3 object not found: ${key}`;
    } else if (name === 'CredentialsProviderError' || name === 'CredentialsError') {
      code = 'CONFIGURATION_ERROR';
      message =
        'AWS credentials are not configured — the default credential provider chain ' +
        '(IAM role, environment variables, or shared credentials file) found none';
    } else if (name === 'AccessDenied' || name === 'Forbidden' || statusCode === 403) {
      code = 'PERMISSION_DENIED';
      message = `Permission denied accessing S3 object: ${key}`;
    } else if (name === 'RequestTimeout' || name === 'TimeoutError' || name === 'NetworkingError') {
      code = 'NETWORK_ERROR';
      message = `Network error during S3 ${operation} for key: ${key}`;
    } else {
      code = 'PROVIDER_ERROR';
      message = `S3 operation '${operation}' failed for key: ${key}`;
    }

    this.logger.error({ key, bucket: this.bucket, operation, code, awsErrorName: name }, message);
    return new StorageError(message, code, 'aws', operation, key, this.bucket, error);
  }
}
