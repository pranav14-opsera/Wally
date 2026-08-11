// Re-exported, not redefined: src/config/schema.ts's zod enum is the single
// source of truth for which CLOUD_PROVIDER/COMPUTE_RUNNER values are valid
// (zero-hardcoding principle — one place to add a new provider, not two).
export type { CloudProvider, ComputeRunner } from '../../../config/schema.js';

export interface StorageUploadOptions {
  metadata?: Record<string, string>;
  contentType?: string;
  encryption?: boolean;
}

export interface StorageDownloadResult {
  data: Buffer;
  metadata?: Record<string, string>;
  contentType?: string;
}

export interface SecretMetadata {
  version: string;
  createdAt: Date;
  rotatedAt?: Date;
}

export interface ComputeTaskConfig {
  command: string;
  args?: string[];
  /** Milliseconds. Must be a positive integer — a zero/negative timeout is rejected by the adapter, not silently treated as "no timeout". */
  timeout?: number;
  environment?: Record<string, string>;
  cpu?: number;
  memory?: number;
}

export type ComputeTaskState = 'pending' | 'running' | 'completed' | 'failed' | 'stopped';

export interface ComputeTaskStatus {
  taskId: string;
  state: ComputeTaskState;
  startedAt?: Date;
  completedAt?: Date;
  exitCode?: number;
  error?: string;
}

/** The terminal-state subset of ComputeTaskStatus — returned once a task reaches 'completed' or 'failed'. */
export interface ComputeTaskResult {
  taskId: string;
  exitCode: number;
  completedAt: Date;
}

export type CloudErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'INVALID_ARGUMENT'
  | 'NOT_IMPLEMENTED'
  | 'PROVIDER_ERROR'
  | 'PERMISSION_DENIED'
  | 'STORAGE_FULL'
  // Secrets-adapter-specific codes (WO-016) — distinct from the generic
  // NOT_FOUND/PROVIDER_ERROR above because callers need to distinguish
  // "this secret doesn't exist" from "the store itself is unusable"
  // (wrong/missing master key, tampered file, lock contention).
  | 'SECRET_NOT_FOUND'
  | 'MASTER_KEY_MISSING'
  | 'CORRUPTION_DETECTED'
  | 'LOCK_TIMEOUT'
  // Compute-adapter-specific codes (WO-017) — same rationale: a caller
  // needs to distinguish "the k6 binary itself is missing" from
  // "this task ID doesn't exist" from "the task's process failed/timed
  // out", not lump them all under NOT_FOUND/PROVIDER_ERROR.
  | 'K6_NOT_FOUND'
  | 'TASK_NOT_FOUND'
  | 'TASK_TIMEOUT'
  | 'TASK_FAILED'
  // S3-adapter-specific codes (WO-018). Deliberately NOT adding a
  // separate "key not found" code here — S3StorageAdapter reuses the
  // existing NOT_FOUND (missing object) and PERMISSION_DENIED (access
  // denied) that FilesystemStorageAdapter already uses for the identical
  // ICloudStorageService scenarios, since both adapters are meant to be
  // conformance-tested as behaviorally interchangeable (WO-022). These
  // two are genuinely new failure modes with no local-filesystem
  // equivalent (a missing S3 bucket or a network timeout don't happen
  // when writing to disk), so they don't collide with that parity goal.
  | 'CONFIGURATION_ERROR'
  | 'NETWORK_ERROR';

interface CloudAdapterErrorJSON {
  name: string;
  message: string;
  code: CloudErrorCode;
  provider: string;
  operation: string;
}

/**
 * Base class for every error a cloud adapter throws. `toJSON()` is
 * deliberately narrow — it never serializes `cause` (which may wrap a
 * driver exception containing credentials/secret values) or any
 * subclass-specific sensitive field (e.g. `SecretsError` never includes
 * the secret value).
 */
export class CloudAdapterError extends Error {
  public constructor(
    message: string,
    public readonly code: CloudErrorCode,
    public readonly provider: string,
    public readonly operation: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CloudAdapterError';
  }

  public toJSON(): CloudAdapterErrorJSON {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      provider: this.provider,
      operation: this.operation,
    };
  }
}

export class StorageError extends CloudAdapterError {
  public constructor(
    message: string,
    code: CloudErrorCode,
    provider: string,
    operation: string,
    public readonly key: string,
    public readonly bucket?: string,
    cause?: unknown,
  ) {
    super(message, code, provider, operation, cause);
    this.name = 'StorageError';
  }
}

/** Never carries the secret value — only its name, matching the audit-log-safe error contract every adapter must uphold. */
export class SecretsError extends CloudAdapterError {
  public constructor(
    message: string,
    code: CloudErrorCode,
    provider: string,
    operation: string,
    public readonly secretName: string,
    cause?: unknown,
  ) {
    super(message, code, provider, operation, cause);
    this.name = 'SecretsError';
  }
}

export class ComputeError extends CloudAdapterError {
  public constructor(
    message: string,
    code: CloudErrorCode,
    provider: string,
    operation: string,
    public readonly taskId: string,
    public readonly exitCode?: number,
    cause?: unknown,
  ) {
    super(message, code, provider, operation, cause);
    this.name = 'ComputeError';
  }
}

/** Thrown by a provider stub (e.g. GCP/Azure before WO-021) for any operation it doesn't yet implement. */
export class ProviderNotImplementedError extends CloudAdapterError {
  public constructor(provider: string, operation: string) {
    super(`${provider} does not implement ${operation}`, 'NOT_IMPLEMENTED', provider, operation);
    this.name = 'ProviderNotImplementedError';
  }
}
