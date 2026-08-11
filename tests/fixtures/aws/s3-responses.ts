/** Typed mock AWS SDK v3 S3 responses/errors, shared across S3StorageAdapter.test.ts for deterministic unit testing (WO-018). */

export function mockPutObjectResponse(): { $metadata: { httpStatusCode: number } } {
  return { $metadata: { httpStatusCode: 200 } };
}

export function mockGetObjectResponse(
  bodyText: string,
  overrides?: { metadata?: Record<string, string>; contentType?: string },
): {
  $metadata: { httpStatusCode: number };
  Body: { transformToByteArray: () => Promise<Uint8Array> };
  Metadata?: Record<string, string>;
  ContentType?: string;
} {
  return {
    $metadata: { httpStatusCode: 200 },
    Body: { transformToByteArray: async () => new TextEncoder().encode(bodyText) },
    Metadata: overrides?.metadata,
    ContentType: overrides?.contentType,
  };
}

export function mockDeleteObjectResponse(): { $metadata: { httpStatusCode: number } } {
  return { $metadata: { httpStatusCode: 204 } };
}

export function mockListObjectsV2Response(
  keys: string[],
  options?: { isTruncated?: boolean; nextContinuationToken?: string },
): {
  $metadata: { httpStatusCode: number };
  Contents: Array<{ Key: string }>;
  IsTruncated?: boolean;
  NextContinuationToken?: string;
} {
  return {
    $metadata: { httpStatusCode: 200 },
    Contents: keys.map((Key) => ({ Key })),
    IsTruncated: options?.isTruncated,
    NextContinuationToken: options?.nextContinuationToken,
  };
}

export function mockHeadObjectResponse(): { $metadata: { httpStatusCode: number } } {
  return { $metadata: { httpStatusCode: 200 } };
}

function mockAwsError(name: string, httpStatusCode: number, message: string): Error & {
  name: string;
  $metadata: { httpStatusCode: number };
} {
  const error = new Error(message) as Error & { name: string; $metadata: { httpStatusCode: number } };
  error.name = name;
  error.$metadata = { httpStatusCode };
  return error;
}

export const mockNoSuchKeyError = (): ReturnType<typeof mockAwsError> =>
  mockAwsError('NoSuchKey', 404, 'The specified key does not exist.');

export const mockNotFoundError = (): ReturnType<typeof mockAwsError> =>
  mockAwsError('NotFound', 404, 'Not Found');

export const mockNoSuchBucketError = (): ReturnType<typeof mockAwsError> =>
  mockAwsError('NoSuchBucket', 404, 'The specified bucket does not exist.');

export const mockAccessDeniedError = (): ReturnType<typeof mockAwsError> =>
  mockAwsError('AccessDenied', 403, 'Access Denied');

export const mockCredentialsProviderError = (): ReturnType<typeof mockAwsError> =>
  mockAwsError('CredentialsProviderError', 0, 'Could not load credentials from any providers');

export const mockRequestTimeoutError = (): ReturnType<typeof mockAwsError> =>
  mockAwsError('RequestTimeout', 400, 'Your socket connection to the server was not read from or written to');

export const mockUnknownServiceError = (): ReturnType<typeof mockAwsError> =>
  mockAwsError('InternalError', 500, 'We encountered an internal error. Please try again.');
