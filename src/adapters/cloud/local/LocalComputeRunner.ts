import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { Logger } from 'pino';

import type { ComputeTaskConfig, ComputeTaskState, ComputeTaskStatus, ICloudComputeService } from '../interfaces/index.js';
import { ComputeError } from '../interfaces/index.js';

const PLACEHOLDER_TASK_ID = '(not yet assigned)';
const CLEANUP_INTERVAL_MS = 60_000;
const K6_VERSION_CHECK_TIMEOUT_MS = 5_000;

export interface K6OutputEntry {
  type: 'Metric' | 'Point';
  data: Record<string, unknown>;
  metric?: string;
}

/**
 * Buffers a byte/text stream into complete lines, holding back whatever
 * comes after the last newline until more data (or `flush()`) arrives —
 * k6's stdout can split a JSON line across multiple `data` chunks.
 */
export class LineBuffer {
  private pending = '';

  public push(chunk: Buffer | string): string[] {
    this.pending += chunk.toString('utf-8');
    const lines = this.pending.split('\n');
    this.pending = lines.pop() ?? '';
    return lines;
  }

  /** Call once the stream ends — returns the final partial line, if any (non-empty after trimming). */
  public flush(): string[] {
    const remainder = this.pending;
    this.pending = '';
    return remainder.trim().length > 0 ? [remainder] : [];
  }
}

/** Parses and validates one k6 JSON-lines entry. Returns null (after logging a warning) for anything that isn't a well-formed Metric/Point object — never throws. */
export function parseK6Line(line: string, logger: Logger, taskId: string): K6OutputEntry | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    logger.warn({ taskId, line: trimmed, err: error }, 'Skipping malformed k6 output line (invalid JSON)');
    return null;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('type' in parsed) ||
    (parsed.type !== 'Metric' && parsed.type !== 'Point') ||
    !('data' in parsed) ||
    typeof (parsed as { data: unknown }).data !== 'object' ||
    (parsed as { data: unknown }).data === null
  ) {
    logger.warn({ taskId, line: trimmed }, 'Skipping k6 output line that does not match the Metric/Point schema');
    return null;
  }

  return parsed as K6OutputEntry;
}

interface TrackedTask {
  process: ChildProcess;
  status: ComputeTaskStatus;
  stderr: string[];
  timeoutHandle?: NodeJS.Timeout;
  graceHandle?: NodeJS.Timeout;
  /** Set once stopTask() explicitly requested termination — distinguishes a user-initiated stop from a timeout-triggered kill in the exit handler. */
  stopRequested: boolean;
  validLines: number;
  invalidLines: number;
}

/**
 * Production-grade (not a mock) ICloudComputeService that runs k6 as a
 * child process — selected when CLOUD_PROVIDER=local or
 * COMPUTE_RUNNER=local. Spawns via `child_process.spawn` (never `exec`,
 * per the WO's constraint, to avoid stdout buffer overflow on large
 * outputs), stream-parses JSON-lines output line-by-line without
 * retaining parsed entries (only counts), and enforces a configurable
 * timeout with a SIGTERM-then-SIGKILL grace period cascade.
 */
export class LocalComputeRunner implements ICloudComputeService {
  private readonly tasks = new Map<string, TrackedTask>();
  private k6AvailabilityPromise: Promise<boolean> | undefined;
  private readonly cleanupInterval: NodeJS.Timeout;

  public constructor(
    private readonly k6BinaryPath: string,
    private readonly defaultTimeoutMs: number,
    private readonly gracePeriodMs: number,
    private readonly taskRetentionMs: number,
    private readonly logger: Logger,
  ) {
    this.cleanupInterval = setInterval(() => this.cleanupOldTasks(), CLEANUP_INTERVAL_MS);
    this.cleanupInterval.unref();
  }

  /** Runs the k6 availability check once at startup (bootstrap.ts calls this) — logs a warning but never throws, so a missing k6 binary doesn't crash the gateway. */
  public async init(): Promise<void> {
    const available = await this.checkK6Availability();
    if (!available) {
      this.logger.warn(
        { k6BinaryPath: this.k6BinaryPath },
        `k6 binary not found in PATH at "${this.k6BinaryPath}" — Load Testing Agent tasks will fail until k6 ` +
          'is installed. See https://k6.io/docs/get-started/installation/.',
      );
    }
  }

  public async runTask(config: ComputeTaskConfig): Promise<string> {
    if (config.timeout !== undefined && config.timeout <= 0) {
      throw new ComputeError(
        `Invalid timeout: ${config.timeout}ms — must be a positive integer`,
        'INVALID_ARGUMENT',
        'local',
        'runTask',
        PLACEHOLDER_TASK_ID,
      );
    }

    const available = await this.ensureAvailabilityChecked();
    if (!available) {
      throw new ComputeError(
        `k6 binary not found in PATH at "${this.k6BinaryPath}". Install k6: ` +
          'https://k6.io/docs/get-started/installation/.',
        'K6_NOT_FOUND',
        'local',
        'runTask',
        PLACEHOLDER_TASK_ID,
      );
    }

    const taskId = randomUUID();
    const timeoutMs = config.timeout ?? this.defaultTimeoutMs;
    const args = ['run', '--out', 'json=-', config.command, ...(config.args ?? [])];

    const child = spawn(this.k6BinaryPath, args, {
      env: { ...process.env, ...config.environment },
    });

    const task: TrackedTask = {
      process: child,
      status: { taskId, state: 'pending' },
      stderr: [],
      stopRequested: false,
      validLines: 0,
      invalidLines: 0,
    };
    this.tasks.set(taskId, task);

    this.wireProcessEvents(taskId, task, timeoutMs);
    return taskId;
  }

  public async getTaskStatus(taskId: string): Promise<ComputeTaskStatus> {
    return this.requireTask(taskId, 'getTaskStatus').status;
  }

  public async stopTask(taskId: string): Promise<void> {
    const task = this.requireTask(taskId, 'stopTask');

    if (task.status.state === 'completed' || task.status.state === 'failed' || task.status.state === 'stopped') {
      return;
    }

    task.stopRequested = true;
    this.clearTimers(task);
    this.safeKill(task.process, 'SIGTERM');
    this.logger.info({ taskId, operation: 'stopTask' }, 'Sent SIGTERM to compute task');
  }

  private requireTask(taskId: string, operation: string): TrackedTask {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new ComputeError(`Compute task not found: ${taskId}`, 'TASK_NOT_FOUND', 'local', operation, taskId);
    }
    return task;
  }

  /** Lazily checks (and caches) k6 availability — used so runTask() still fails descriptively even if init() was never called (e.g. in tests). */
  private ensureAvailabilityChecked(): Promise<boolean> {
    this.k6AvailabilityPromise ??= this.checkK6Availability();
    return this.k6AvailabilityPromise;
  }

  private checkK6Availability(): Promise<boolean> {
    return new Promise((resolve) => {
      const probe = spawn(this.k6BinaryPath, ['version']);
      const timer = setTimeout(() => {
        probe.kill('SIGKILL');
        resolve(false);
      }, K6_VERSION_CHECK_TIMEOUT_MS);
      timer.unref();

      probe.once('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
      probe.once('exit', (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    });
  }

  private wireProcessEvents(taskId: string, task: TrackedTask, timeoutMs: number): void {
    const stdoutBuffer = new LineBuffer();
    const stderrBuffer = new LineBuffer();

    task.process.once('spawn', () => {
      task.status = { ...task.status, state: 'running', startedAt: new Date() };
      task.timeoutHandle = setTimeout(() => this.handleTimeout(taskId, task), timeoutMs);
      task.timeoutHandle.unref();
      this.logger.info({ taskId, timeoutMs }, 'k6 compute task started');
    });

    task.process.stdout?.on('data', (chunk: Buffer) => {
      for (const line of stdoutBuffer.push(chunk)) {
        this.processLine(taskId, task, line);
      }
    });

    task.process.stderr?.on('data', (chunk: Buffer) => {
      for (const line of stderrBuffer.push(chunk)) {
        task.stderr.push(line);
      }
    });

    task.process.once('error', (error) => {
      // Spawn failed after the availability probe passed (e.g. the binary
      // was removed in between) — no exit code will ever follow.
      this.clearTimers(task);
      task.status = {
        ...task.status,
        state: 'failed',
        completedAt: new Date(),
        error: `Failed to start k6 process: ${error.message}`,
      };
      this.logger.error({ taskId, err: error }, 'k6 compute task failed to start');
    });

    task.process.once('exit', (code, signal) => {
      for (const line of stdoutBuffer.flush()) {
        this.processLine(taskId, task, line);
      }
      for (const line of stderrBuffer.flush()) {
        task.stderr.push(line);
      }
      this.finalizeTask(taskId, task, code, signal);
    });
  }

  private processLine(taskId: string, task: TrackedTask, line: string): void {
    const entry = parseK6Line(line, this.logger, taskId);
    if (entry) {
      task.validLines += 1;
    } else if (line.trim().length > 0) {
      task.invalidLines += 1;
    }
  }

  private handleTimeout(taskId: string, task: TrackedTask): void {
    if (task.status.state !== 'running') {
      return;
    }

    this.logger.warn({ taskId }, 'k6 compute task exceeded its timeout — sending SIGTERM');
    this.safeKill(task.process, 'SIGTERM');
    task.graceHandle = setTimeout(() => {
      if (task.status.state === 'running') {
        this.logger.warn({ taskId }, 'k6 compute task still running after grace period — sending SIGKILL');
        this.safeKill(task.process, 'SIGKILL');
      }
    }, this.gracePeriodMs);
    task.graceHandle.unref();
    // Marked here (not just in the exit handler) so a hung process that
    // never emits 'exit' still reports TASK_TIMEOUT via getTaskStatus.
    task.status = { ...task.status, error: 'Task exceeded its configured timeout' };
  }

  private finalizeTask(
    taskId: string,
    task: TrackedTask,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    this.clearTimers(task);
    const completedAt = new Date();
    const wasTimedOut = task.status.error === 'Task exceeded its configured timeout';

    let state: ComputeTaskState;
    let error: string | undefined;

    if (task.stopRequested) {
      state = 'stopped';
    } else if (wasTimedOut) {
      state = 'failed';
      error = `Task exceeded its configured timeout (killed via ${signal ?? 'SIGKILL'})`;
      this.logger.error({ taskId, code, signal }, 'k6 compute task timed out');
    } else if (code !== 0) {
      state = 'failed';
      const failure = new ComputeError(
        `k6 process exited with code ${code ?? 'null'}${signal ? ` (signal ${signal})` : ''}`,
        'TASK_FAILED',
        'local',
        'runTask',
        taskId,
        code ?? undefined,
      );
      error = task.stderr.length > 0 ? `${failure.message}: ${task.stderr.join('\n').slice(0, 2000)}` : failure.message;
      this.logger.error({ taskId, code, signal, stderr: task.stderr.join('\n') }, 'k6 compute task failed');
    } else {
      state = 'completed';
    }

    task.status = { ...task.status, state, completedAt, exitCode: code ?? undefined, ...(error ? { error } : {}) };
    this.logger.info(
      { taskId, state, validLines: task.validLines, invalidLines: task.invalidLines },
      'k6 compute task finished',
    );
  }

  private clearTimers(task: TrackedTask): void {
    if (task.timeoutHandle) {
      clearTimeout(task.timeoutHandle);
      task.timeoutHandle = undefined;
    }
    if (task.graceHandle) {
      clearTimeout(task.graceHandle);
      task.graceHandle = undefined;
    }
  }

  /** kill() on an already-exited process is a safe no-op in Node, but a defensive try/catch guards against any platform-specific throw. */
  private safeKill(child: ChildProcess, sig: NodeJS.Signals): void {
    try {
      child.kill(sig);
    } catch {
      // Already exited — nothing to do.
    }
  }

  private cleanupOldTasks(): void {
    const now = Date.now();
    for (const [taskId, task] of this.tasks) {
      const terminal = task.status.state === 'completed' || task.status.state === 'failed' || task.status.state === 'stopped';
      const completedAt = task.status.completedAt?.getTime();
      if (terminal && completedAt !== undefined && now - completedAt > this.taskRetentionMs) {
        this.tasks.delete(taskId);
      }
    }
  }
}
