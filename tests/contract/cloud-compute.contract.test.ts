import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import * as childProcess from 'node:child_process';

import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AzureComputeStub } from '../../src/adapters/cloud/azure/AzureComputeStub.js';
import { GcpComputeStub } from '../../src/adapters/cloud/gcp/GcpComputeStub.js';
import type { ComputeTaskStatus, ICloudComputeService } from '../../src/adapters/cloud/interfaces/index.js';
import { ProviderNotImplementedError } from '../../src/adapters/cloud/interfaces/index.js';
import { LocalComputeRunner } from '../../src/adapters/cloud/local/LocalComputeRunner.js';

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof childProcess>('node:child_process');
  return { ...actual, spawn: vi.fn() };
});

const silentLogger = pino({ level: 'silent' });

async function pollUntilTerminal(
  adapter: ICloudComputeService,
  taskId: string,
  maxAttempts = 50,
): Promise<ComputeTaskStatus> {
  const terminalStates = new Set(['completed', 'failed', 'stopped']);
  let status = await adapter.getTaskStatus(taskId);
  let attempts = 0;
  while (!terminalStates.has(status.state) && attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    status = await adapter.getTaskStatus(taskId);
    attempts += 1;
  }
  return status;
}

/**
 * WO-022: the same test logic runs against every ICloudComputeService
 * implementation. Compute is inherently asynchronous (a real task runs in
 * the background), so — unlike the storage/secrets contracts — this one
 * polls `getTaskStatus` to a terminal state rather than asserting an
 * immediate result, matching how a real caller (BaseAgent) must use this
 * interface.
 */
export function runComputeContractTests(
  name: string,
  createAdapter: () => ICloudComputeService | Promise<ICloudComputeService>,
  options: { expectNotImplemented?: boolean } = {},
): void {
  describe(`ICloudComputeService contract: ${name}`, () => {
    let adapter: ICloudComputeService;

    beforeEach(async () => {
      adapter = await createAdapter();
    });

    if (options.expectNotImplemented) {
      it.each([
        ['runTask', () => adapter.runTask({ command: 'echo hi' })],
        ['getTaskStatus', () => adapter.getTaskStatus('task-id')],
        ['stopTask', () => adapter.stopTask('task-id')],
      ] as const)('%s() throws ProviderNotImplementedError', async (_method, call) => {
        await expect(call()).rejects.toBeInstanceOf(ProviderNotImplementedError);
      });
      return;
    }

    it('runTask() returns a task ID, and getTaskStatus() eventually reaches a terminal state', async () => {
      const taskId = await adapter.runTask({ command: 'echo hello' });
      expect(typeof taskId).toBe('string');
      expect(taskId.length).toBeGreaterThan(0);

      const finalStatus = await pollUntilTerminal(adapter, taskId);
      expect(['completed', 'failed']).toContain(finalStatus.state);
    });

    it('getTaskStatus() rejects for an unknown task ID', async () => {
      await expect(adapter.getTaskStatus('does-not-exist-12345')).rejects.toThrow();
    });

    it('stopTask() on a task does not throw, whether it is still running or already terminal', async () => {
      const taskId = await adapter.runTask({ command: 'echo hello' });
      await expect(adapter.stopTask(taskId)).resolves.not.toThrow();
    });

    it('stopTask() rejects for an unknown task ID', async () => {
      await expect(adapter.stopTask('does-not-exist-12345')).rejects.toThrow();
    });
  });
}

/** Auto-completing fake child process: every spawn() resolves as if the process started and exited 0 almost immediately — enough for LocalComputeRunner's real (non-k6-specific) state-machine logic to run for real, without needing an actual k6 binary or hand-driven event timing per test. */
class AutoCompletingChildProcess extends EventEmitter {
  public readonly stdout = new EventEmitter();
  public readonly stderr = new EventEmitter();
  public killed = false;

  public kill(): boolean {
    this.killed = true;
    return true;
  }
}

beforeEach(() => {
  vi.mocked(childProcess.spawn).mockReset();
  vi.mocked(childProcess.spawn).mockImplementation(() => {
    const proc = new AutoCompletingChildProcess();
    queueMicrotask(() => {
      proc.emit('spawn');
      queueMicrotask(() => proc.emit('exit', 0, null));
    });
    return proc as unknown as ChildProcess;
  });
});

runComputeContractTests(
  'local (LocalComputeRunner, k6 process mocked)',
  () => new LocalComputeRunner('k6', 5_000, 200, 60_000, silentLogger),
);

// ECSComputeRunner (WO-020) is not yet merged as of this WO — an
// "aws (mocked SDK)" branch will be added alongside it. The registry-based
// factory design (src/adapters/cloud/factory.ts) means no changes will be
// needed here beyond adding that branch once the adapter exists.

runComputeContractTests('gcp (GcpComputeStub)', () => new GcpComputeStub(), { expectNotImplemented: true });
runComputeContractTests('azure (AzureComputeStub)', () => new AzureComputeStub(), { expectNotImplemented: true });
