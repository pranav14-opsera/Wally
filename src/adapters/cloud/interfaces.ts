/** Thrown by ICloudStorageService.download when the key does not exist. */
export class StorageObjectNotFoundError extends Error {
  public constructor(key: string) {
    super(`Storage object not found: ${key}`);
    this.name = 'StorageObjectNotFoundError';
  }
}

export interface ICloudStorageService {
  upload(key: string, data: Buffer, metadata?: Record<string, string>): Promise<void>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  exists(key: string): Promise<boolean>;
}

/** Thrown by ICloudSecretsService.getSecret when the key does not exist, matching AWS Secrets Manager's ResourceNotFoundException behavior. */
export class SecretNotFoundError extends Error {
  public constructor(key: string) {
    super(`Secret not found: ${key}`);
    this.name = 'SecretNotFoundError';
  }
}

export interface ICloudSecretsService {
  getSecret(key: string): Promise<string>;
  putSecret(key: string, value: string): Promise<void>;
  rotateSecret(key: string, newValue: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
  listSecrets(): Promise<string[]>;
}

export interface ComputeTaskConfig {
  taskType: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

export type ComputeTaskState = 'pending' | 'running' | 'completed' | 'failed' | 'stopped';

export interface ComputeTaskStatus {
  taskId: string;
  state: ComputeTaskState;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number;
  error?: string;
}

/** Thrown by ICloudComputeService.getTaskStatus/stopTask when the task ID is unknown. */
export class ComputeTaskNotFoundError extends Error {
  public constructor(taskId: string) {
    super(`Compute task not found: ${taskId}`);
    this.name = 'ComputeTaskNotFoundError';
  }
}

export interface ICloudComputeService {
  runTask(config: ComputeTaskConfig): Promise<string>;
  getTaskStatus(taskId: string): Promise<ComputeTaskStatus>;
  stopTask(taskId: string): Promise<void>;
}
