import { randomUUID } from 'node:crypto';

import type { ComputeTaskConfig, ComputeTaskStatus, ICloudComputeService } from '../interfaces.js';
import { ComputeTaskNotFoundError } from '../interfaces.js';

interface TrackedTask {
  config: ComputeTaskConfig;
  status: ComputeTaskStatus;
}

/**
 * In-memory ICloudComputeService for local development and testing.
 *
 * Simulates the pending -> running -> completed lifecycle deterministically:
 * each call to `getTaskStatus` advances the task by one step (rather than
 * using real timers), so tests can observe every transition synchronously
 * without fake-timer setup or flaky waits.
 */
export class StubComputeAdapter implements ICloudComputeService {
  private readonly tasks = new Map<string, TrackedTask>();

  public async runTask(config: ComputeTaskConfig): Promise<string> {
    const taskId = randomUUID();
    this.tasks.set(taskId, {
      config,
      status: { taskId, state: 'pending' },
    });
    return taskId;
  }

  public async getTaskStatus(taskId: string): Promise<ComputeTaskStatus> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new ComputeTaskNotFoundError(taskId);
    }

    if (task.status.state === 'pending') {
      task.status = { ...task.status, state: 'running', startedAt: new Date().toISOString() };
    } else if (task.status.state === 'running') {
      task.status = {
        ...task.status,
        state: 'completed',
        completedAt: new Date().toISOString(),
        exitCode: 0,
      };
    }

    return task.status;
  }

  public async stopTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new ComputeTaskNotFoundError(taskId);
    }

    if (task.status.state === 'completed' || task.status.state === 'failed') {
      return;
    }

    task.status = { ...task.status, state: 'stopped', completedAt: new Date().toISOString() };
  }
}
