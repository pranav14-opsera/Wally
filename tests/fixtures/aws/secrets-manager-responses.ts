import {
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  GetSecretValueCommand,
  InvalidRequestException,
  PutSecretValueCommand,
  ResourceExistsException,
  ResourceNotFoundException,
  RestoreSecretCommand,
} from '@aws-sdk/client-secrets-manager';
import type {
  CreateSecretResponse,
  DeleteSecretResponse,
  DescribeSecretResponse,
  GetSecretValueResponse,
  PutSecretValueResponse,
  RestoreSecretResponse,
} from '@aws-sdk/client-secrets-manager';

/**
 * Typed mock AWS Secrets Manager responses/errors for SecretsManagerAdapter's
 * unit tests (WO-019) — deterministic fixtures instead of ad-hoc inline
 * objects duplicated across test cases, mirroring the fixture-file
 * convention already used for Mongoose contract fixtures (WO-011/WO-012).
 */

const FAKE_ARN_PREFIX = 'arn:aws:secretsmanager:us-east-1:123456789012:secret';

export function fakeSecretArn(name: string): string {
  return `${FAKE_ARN_PREFIX}:${name}-AbCdEf`;
}

export function createSecretResponse(name: string, versionId = 'version-1'): CreateSecretResponse {
  return { ARN: fakeSecretArn(name), Name: name, VersionId: versionId };
}

export function putSecretValueResponse(name: string, versionId = 'version-2'): PutSecretValueResponse {
  return { ARN: fakeSecretArn(name), Name: name, VersionId: versionId, VersionStages: ['AWSCURRENT'] };
}

export function getSecretValueResponse(name: string, secretString: string, versionId = 'version-1'): GetSecretValueResponse {
  return {
    ARN: fakeSecretArn(name),
    Name: name,
    VersionId: versionId,
    SecretString: secretString,
    VersionStages: ['AWSCURRENT'],
    CreatedDate: new Date('2026-01-01T00:00:00.000Z'),
  };
}

export function deleteSecretResponse(name: string): DeleteSecretResponse {
  return { ARN: fakeSecretArn(name), Name: name, DeletionDate: new Date('2026-02-01T00:00:00.000Z') };
}

export function describeSecretResponse(name: string): DescribeSecretResponse {
  return { ARN: fakeSecretArn(name), Name: name };
}

export function restoreSecretResponse(name: string): RestoreSecretResponse {
  return { ARN: fakeSecretArn(name), Name: name };
}

// --- Error fixtures -------------------------------------------------------
// Constructed via each modeled exception's own constructor (not plain
// `new Error()` with a manually-set `.name`) so they carry the exact
// shape `instanceof` checks and AWS SDK's own error machinery expect —
// same rationale as WO-011's mongoose error-mapper tests constructing
// real `mongoose.mongo.MongoServerError` instances instead of look-alikes.

export function resourceNotFoundError(message = 'Secrets Manager can\'t find the specified secret.'): ResourceNotFoundException {
  return new ResourceNotFoundException({ message, $metadata: { requestId: 'req-not-found' } });
}

export function resourceExistsError(message = 'A resource with this name already exists.'): ResourceExistsException {
  return new ResourceExistsException({ message, $metadata: { requestId: 'req-exists' } });
}

export function invalidRequestError(
  message = 'You can\'t perform this operation on the secret because it was marked for deletion.',
): InvalidRequestException {
  return new InvalidRequestException({ message, $metadata: { requestId: 'req-invalid' } });
}

/** AccessDeniedException isn't a modeled Secrets-Manager-specific exception — it's a plain error with this name, exactly how it actually arrives from the SDK's IAM-layer middleware. */
export function accessDeniedError(message = 'User is not authorized to perform this action.'): Error {
  const error = new Error(message);
  error.name = 'AccessDeniedException';
  (error as Error & { $metadata: { requestId: string } }).$metadata = { requestId: 'req-denied' };
  return error;
}

export function throttlingError(message = 'Rate exceeded'): Error {
  const error = new Error(message);
  error.name = 'ThrottlingException';
  (error as Error & { $metadata: { requestId: string } }).$metadata = { requestId: 'req-throttled' };
  return error;
}

export function credentialsProviderError(message = 'Could not load credentials from any providers'): Error {
  const error = new Error(message);
  error.name = 'CredentialsProviderError';
  return error;
}

export function internalServiceError(message = 'An internal error occurred.'): Error {
  const error = new Error(message);
  error.name = 'InternalServiceError';
  (error as Error & { $metadata: { requestId: string } }).$metadata = { requestId: 'req-internal' };
  return error;
}

// Re-exported so test files can construct commands against the mocked
// `send()` and assert on which command type was actually issued, without
// each test file importing the AWS SDK package directly.
export {
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  RestoreSecretCommand,
};
