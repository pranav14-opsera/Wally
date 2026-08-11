import type { ComputeTaskConfig, ComputeTaskStatus } from './cloud-adapter.types.js';

export interface ICloudComputeService {
  /** Returns the task ID immediately — the task runs asynchronously; poll `getTaskStatus` for its outcome. */
  runTask(config: ComputeTaskConfig): Promise<string>;
  getTaskStatus(taskId: string): Promise<ComputeTaskStatus>;
  stopTask(taskId: string): Promise<void>;
  /**
   * Optional one-time startup hook (e.g. LocalComputeRunner's k6-binary
   * availability check). Not every implementation needs it —
   * bootstrap.ts calls it via `cloudCompute.init?.()`.
   */
  init?(): Promise<void>;
}
