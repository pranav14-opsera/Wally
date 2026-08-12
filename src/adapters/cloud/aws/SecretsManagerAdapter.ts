import {
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  GetSecretValueCommand,
  InvalidRequestException,
  PutSecretValueCommand,
  ResourceExistsException,
  RestoreSecretCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import type { Logger } from 'pino';

import type { ICloudSecretsService, SecretMetadata } from '../interfaces/index.js';
import { SecretsError } from '../interfaces/index.js';

// AWS Secrets Manager's own hard limit on the `Name` field, after any
// namespace prefix has been applied — see buildSecretName's doc comment.
const MAX_SECRET_NAME_LENGTH = 512;

function errorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** AWS SDK v3 errors carry the request ID under `$metadata.requestId` — useful for support tickets, never sensitive, safe to include in error text. */
function extractRequestId(error: unknown): string | undefined {
  if (error && typeof error === 'object' && '$metadata' in error) {
    const metadata = (error as { $metadata?: { requestId?: string } }).$metadata;
    return metadata?.requestId;
  }
  return undefined;
}

/**
 * Production-grade `ICloudSecretsService` backed by AWS Secrets Manager —
 * selected when `CLOUD_PROVIDER=aws`. Behaves identically to
 * `LocalSecretsAdapter` (WO-016) for every method: same interface, same
 * "delete of something already gone is a no-op" idempotency, same
 * "never log or error-message the secret value" discipline (every
 * `SecretsError` this class throws carries the secret *name*, never the
 * value — see `mapAwsError`; and no method here ever logs a value, only
 * names/version IDs).
 *
 * Unlike `LocalSecretsAdapter`, this adapter has no `init()` hook: AWS
 * deployments are expected to pre-provision the JWT signing key pair in
 * Secrets Manager as part of infrastructure setup (e.g. Terraform/CDK),
 * not have the application auto-generate and silently overwrite
 * production signing keys on every restart the way the local-dev adapter
 * does for developer convenience.
 */
export class SecretsManagerAdapter implements ICloudSecretsService {
  private readonly client: SecretsManagerClient;

  public constructor(
    private readonly namespace: string,
    private readonly forceDeleteWithoutRecovery: boolean,
    private readonly logger: Logger,
    client?: SecretsManagerClient,
  ) {
    // No explicit `region`/`credentials` passed when a client isn't
    // injected — the AWS SDK v3 default provider chain already resolves
    // both (IAM role > AWS_REGION/AWS_ACCESS_KEY_ID-style env vars >
    // shared ~/.aws/config|credentials), which is exactly what this WO's
    // "must use the default credential provider chain, never hardcoded"
    // constraint requires. Re-implementing that resolution ourselves
    // here would just be a second, divergent copy of what the SDK
    // already does correctly.
    this.client = client ?? new SecretsManagerClient({});
  }

  /**
   * Prepends the configurable namespace (e.g. `wally/`) to avoid
   * collisions with other applications/environments sharing the same AWS
   * account's Secrets Manager, and validates the result against Secrets
   * Manager's 512-character `Name` limit — a namespace long enough to
   * push an otherwise-valid name over that limit must fail clearly here,
   * not as an opaque `InvalidParameterException` from the API.
   */
  private buildSecretName(name: string): string {
    const fullName = `${this.namespace}${name}`;
    if (fullName.length > MAX_SECRET_NAME_LENGTH) {
      throw new SecretsError(
        `Secret name "${fullName}" is ${fullName.length} characters, exceeding Secrets Manager's ` +
          `${MAX_SECRET_NAME_LENGTH}-character limit after applying the "${this.namespace}" namespace prefix ` +
          '(SECRETS_NAMESPACE). Use a shorter secret name.',
        'INVALID_ARGUMENT',
        'aws',
        'buildSecretName',
        name,
      );
    }
    return fullName;
  }

  /**
   * Maps every AWS SDK failure this adapter can see to the shared
   * `SecretsError` hierarchy. Matches on `error.name` (not `instanceof`)
   * so it uniformly covers both Secrets-Manager-modeled exceptions
   * (`ResourceNotFoundException`, etc., exported by
   * `@aws-sdk/client-secrets-manager`) and cross-cutting SDK errors that
   * aren't modeled per-service (`AccessDeniedException` from IAM,
   * `ThrottlingException`, `CredentialsProviderError` from the credential
   * resolver) without needing to import a class for each.
   */
  private mapAwsError(error: unknown, secretName: string, operation: string): SecretsError {
    const name = errorName(error);
    const message = errorMessage(error);
    const requestId = extractRequestId(error);
    const suffix = requestId ? ` (AWS request ${requestId})` : '';

    switch (name) {
      case 'ResourceNotFoundException':
        return new SecretsError(`Secret not found: ${secretName}${suffix}`, 'SECRET_NOT_FOUND', 'aws', operation, secretName, error);
      case 'ResourceExistsException':
        return new SecretsError(`Secret already exists: ${secretName}${suffix}`, 'ALREADY_EXISTS', 'aws', operation, secretName, error);
      case 'AccessDeniedException':
        return new SecretsError(
          `Access denied for ${operation} on "${secretName}"${suffix} — check that the IAM role/user has a policy ` +
            `granting secretsmanager:${operation}.`,
          'PERMISSION_DENIED',
          'aws',
          operation,
          secretName,
          error,
        );
      case 'InvalidRequestException':
      case 'InvalidParameterException':
      case 'InvalidNextTokenException':
      case 'MalformedPolicyDocumentException':
      case 'PublicPolicyException':
      case 'PreconditionNotMetException':
        return new SecretsError(`Invalid request for secret "${secretName}"${suffix}: ${message}`, 'INVALID_ARGUMENT', 'aws', operation, secretName, error);
      case 'ThrottlingException':
        return new SecretsError(
          `AWS Secrets Manager rate-limited ${operation} on "${secretName}"${suffix} — retry with exponential backoff.`,
          'RATE_LIMITED',
          'aws',
          operation,
          secretName,
          error,
        );
      case 'CredentialsProviderError':
      case 'CredentialsProviderException':
        return new SecretsError(
          'AWS credentials are not configured — SecretsManagerAdapter requires the default credential provider ' +
            'chain (IAM role, environment variables, or a shared credentials file) to resolve valid credentials ' +
            'before it can reach Secrets Manager.',
          'CONFIGURATION_ERROR',
          'aws',
          operation,
          secretName,
          error,
        );
      // DecryptionFailure, EncryptionFailure, InternalServiceError,
      // LimitExceededException, and any other AWS/network failure not
      // explicitly classified above — genuinely "the store itself
      // couldn't complete this operation", the same PROVIDER_ERROR
      // semantics the code's own doc comment describes.
      default:
        return new SecretsError(
          `AWS Secrets Manager error during ${operation} on "${secretName}"${suffix}: ${message}`,
          'PROVIDER_ERROR',
          'aws',
          operation,
          secretName,
          error,
        );
    }
  }

  public async getSecret(name: string): Promise<string> {
    const secretId = this.buildSecretName(name);
    try {
      const response = await this.client.send(new GetSecretValueCommand({ SecretId: secretId }));
      // Deliberately never logged — see this class's doc comment. Only
      // non-sensitive response metadata (version/ARN) would be safe to
      // log, and ICloudSecretsService.getSecret's return type is a bare
      // string (WO-007/WO-014's established interface), so there's
      // nowhere to surface VersionId/ARN/CreatedDate to the caller even
      // if we wanted to — logged at debug level here instead, matching
      // the "version, ARN, createdDate" visibility this WO's AC4 asks
      // for without breaking the already-established interface contract.
      this.logger.debug(
        { secretName: name, operation: 'getSecret', versionId: response.VersionId, arn: response.ARN, createdAt: response.CreatedDate },
        'Secret retrieved',
      );
      if (response.SecretString === undefined) {
        throw new SecretsError(
          `Secret "${name}" has no string value — binary secrets (SecretBinary) are not supported by this adapter.`,
          'INVALID_ARGUMENT',
          'aws',
          'getSecret',
          name,
        );
      }
      return response.SecretString;
    } catch (error) {
      if (error instanceof SecretsError) {
        throw error;
      }
      // A secret whose only remaining versions are staged AWSPREVIOUS
      // (no AWSCURRENT) surfaces from AWS as a plain ResourceNotFoundException
      // here too — mapAwsError's existing SECRET_NOT_FOUND branch already
      // handles it correctly without a special case.
      throw this.mapAwsError(error, name, 'getSecret');
    }
  }

  public async putSecret(name: string, value: string): Promise<SecretMetadata> {
    const secretId = this.buildSecretName(name);

    try {
      const response = await this.client.send(new CreateSecretCommand({ Name: secretId, SecretString: value }));
      this.logger.info({ secretName: name, operation: 'putSecret', versionId: response.VersionId }, 'Secret created');
      return { version: response.VersionId ?? '', createdAt: new Date() };
    } catch (error) {
      if (!(error instanceof ResourceExistsException)) {
        throw this.mapAwsError(error, name, 'putSecret');
      }
    }

    // The secret already exists — fall back to adding a new version.
    return this.putSecretValueWithRestoreFallback(secretId, name, value, 'putSecret');
  }

  public async rotateSecret(name: string, newValue: string): Promise<SecretMetadata> {
    const secretId = this.buildSecretName(name);

    // Verify existence first (AC/implementation_steps' explicit ask) so a
    // rotation attempt against a name that was never created gets a
    // clear SECRET_NOT_FOUND rather than being indistinguishable from a
    // successful rotation of nothing.
    try {
      await this.client.send(new DescribeSecretCommand({ SecretId: secretId }));
    } catch (error) {
      throw this.mapAwsError(error, name, 'rotateSecret');
    }

    const metadata = await this.putSecretValueWithRestoreFallback(secretId, name, newValue, 'rotateSecret');
    return { ...metadata, rotatedAt: new Date() };
  }

  public async deleteSecret(name: string): Promise<void> {
    const secretId = this.buildSecretName(name);
    try {
      await this.client.send(
        new DeleteSecretCommand({ SecretId: secretId, ForceDeleteWithoutRecovery: this.forceDeleteWithoutRecovery }),
      );
      this.logger.info(
        { secretName: name, operation: 'deleteSecret', forceDeleteWithoutRecovery: this.forceDeleteWithoutRecovery },
        this.forceDeleteWithoutRecovery
          ? 'Secret permanently deleted'
          : 'Secret scheduled for deletion (recovery window applies — see DeleteSecretRequest.RecoveryWindowInDays)',
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'ResourceNotFoundException') {
        // Idempotent — matches LocalSecretsAdapter/ICloudSecretsService's
        // implicit "delete of something already gone is a no-op" contract.
        return;
      }
      throw this.mapAwsError(error, name, 'deleteSecret');
    }
  }

  /**
   * `PutSecretValueCommand` against a secret that's currently scheduled
   * for deletion fails with `InvalidRequestException` — recovered here by
   * calling `RestoreSecretCommand` (undoing the pending deletion) and
   * retrying exactly once, rather than surfacing that as an opaque
   * INVALID_ARGUMENT to a caller who just wanted to write a value.
   */
  private async putSecretValueWithRestoreFallback(
    secretId: string,
    name: string,
    value: string,
    operation: string,
  ): Promise<SecretMetadata> {
    try {
      const response = await this.client.send(new PutSecretValueCommand({ SecretId: secretId, SecretString: value }));
      this.logger.info({ secretName: name, operation, versionId: response.VersionId }, 'Secret value updated');
      return { version: response.VersionId ?? '', createdAt: new Date() };
    } catch (error) {
      if (!(error instanceof InvalidRequestException)) {
        throw this.mapAwsError(error, name, operation);
      }
    }

    try {
      await this.client.send(new RestoreSecretCommand({ SecretId: secretId }));
    } catch (restoreError) {
      throw this.mapAwsError(restoreError, name, operation);
    }

    try {
      const retryResponse = await this.client.send(new PutSecretValueCommand({ SecretId: secretId, SecretString: value }));
      this.logger.info(
        { secretName: name, operation, versionId: retryResponse.VersionId, restoredFromPendingDeletion: true },
        'Secret restored from pending deletion and updated',
      );
      return { version: retryResponse.VersionId ?? '', createdAt: new Date() };
    } catch (retryError) {
      throw this.mapAwsError(retryError, name, operation);
    }
  }
}
