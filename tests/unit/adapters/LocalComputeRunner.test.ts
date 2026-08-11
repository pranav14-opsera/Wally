import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ChildProcess } from 'node:child_process';
import * as childProcess from 'node:child_process';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComputeError } from '../../../src/adapters/cloud/index.js';
import { LineBuffer, LocalComputeRunner, parseK6Line } from '../../../src/adapters/cloud/local/LocalComputeRunner.js';

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof childProcess>('node:child_process');
  return { ...actual, spawn: vi.fn() };
});

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'k6-output');
const silentLogger = pino({ level: 'silent' });

class FakeChildProcess extends EventEmitter {
  public readonly stdout = new EventEmitter();
  public readonly stderr = new EventEmitter();
  public readonly killSignals: string[] = [];
  public killed = false;

  public kill(signal?: NodeJS.Signals): boolean {
    this.killSignals.push(signal ?? 'SIGTERM');
    this.killed = true;
    return true;
  }
}

let spawnQueue: FakeChildProcess[];
const spawnMock = vi.mocked(childProcess.spawn);

beforeEach(() => {
  spawnQueue = [];
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => {
    const next = spawnQueue.shift();
    if (!next) {
      throw new Error('LocalComputeRunner.test.ts: no queued fake process for this spawn() call');
    }
    return next as unknown as ChildProcess;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function newRunner(overrides?: { timeoutMs?: number; graceMs?: number; retentionMs?: number }): LocalComputeRunner {
  return new LocalComputeRunner(
    'k6',
    overrides?.timeoutMs ?? 600_000,
    overrides?.graceMs ?? 10_000,
    overrides?.retentionMs ?? 3_600_000,
    silentLogger,
  );
}

/** Queues a version-check process and resolves it successfully, then queues + returns the process used for the actual task's spawn() call. */
async function runTaskWithAvailableK6(
  runner: LocalComputeRunner,
  config: Parameters<LocalComputeRunner['runTask']>[0],
): Promise<{ taskId: string; process: FakeChildProcess }> {
  const versionProcess = new FakeChildProcess();
  const taskProcess = new FakeChildProcess();
  spawnQueue.push(versionProcess, taskProcess);

  const runPromise = runner.runTask(config);
  versionProcess.emit('exit', 0);
  const taskId = await runPromise;
  return { taskId, process: taskProcess };
}

describe('parseK6Line', () => {
  it('parses a valid Metric line', () => {
    const entry = parseK6Line(
      '{"type":"Metric","data":{"name":"http_reqs"},"metric":"http_reqs"}',
      silentLogger,
      'task-1',
    );
    expect(entry).toEqual({ type: 'Metric', data: { name: 'http_reqs' }, metric: 'http_reqs' });
  });

  it('parses a valid Point line', () => {
    const entry = parseK6Line(
      '{"type":"Point","data":{"time":"2026-01-01T00:00:00.000Z","value":1}}',
      silentLogger,
      'task-1',
    );
    expect(entry?.type).toBe('Point');
  });

  it('returns null for invalid JSON without throwing', () => {
    expect(parseK6Line('not json {{{', silentLogger, 'task-1')).toBeNull();
  });

  it('returns null for a well-formed object with the wrong type field', () => {
    expect(parseK6Line('{"type":"Unknown","data":{}}', silentLogger, 'task-1')).toBeNull();
  });

  it('returns null when data is missing or not an object', () => {
    expect(parseK6Line('{"type":"Point"}', silentLogger, 'task-1')).toBeNull();
    expect(parseK6Line('{"type":"Point","data":"nope"}', silentLogger, 'task-1')).toBeNull();
  });

  it('returns null for a blank line', () => {
    expect(parseK6Line('   ', silentLogger, 'task-1')).toBeNull();
  });

  it('parses every line of the committed valid-output fixture', async () => {
    const raw = await readFile(join(FIXTURES_DIR, 'valid-output.jsonl'), 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    const parsed = lines.map((line) => parseK6Line(line, silentLogger, 'fixture-task'));
    expect(parsed.every((entry) => entry !== null)).toBe(true);
    expect(parsed).toHaveLength(5);
  });

  it('parses only the valid lines of the committed malformed-output fixture, skipping the rest', async () => {
    const raw = await readFile(join(FIXTURES_DIR, 'malformed-output.jsonl'), 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    const parsed = lines.map((line) => parseK6Line(line, silentLogger, 'fixture-task'));
    const validCount = parsed.filter((entry) => entry !== null).length;
    expect(validCount).toBe(3);
    expect(parsed.some((entry) => entry === null)).toBe(true);
  });

  it('the committed empty-output fixture yields zero lines', async () => {
    const raw = await readFile(join(FIXTURES_DIR, 'empty-output.jsonl'), 'utf-8');
    expect(raw.trim()).toBe('');
  });
});

describe('LineBuffer', () => {
  it('yields complete lines and buffers an incomplete trailing segment', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('{"a":1}\n{"b":2}\n{"c"')).toEqual(['{"a":1}', '{"b":2}']);
    expect(buffer.push(':3}\n')).toEqual(['{"c":3}']);
  });

  it('handles a line split across many small chunks', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('{"a"')).toEqual([]);
    expect(buffer.push(':')).toEqual([]);
    expect(buffer.push('1}')).toEqual([]);
    expect(buffer.push('\n')).toEqual(['{"a":1}']);
  });

  it('flush() returns a non-empty pending remainder and nothing on an empty/whitespace remainder', () => {
    const buffer = new LineBuffer();
    buffer.push('{"a":1}');
    expect(buffer.flush()).toEqual(['{"a":1}']);

    const empty = new LineBuffer();
    empty.push('   \n  ');
    expect(empty.flush()).toEqual([]);
  });
});

describe('LocalComputeRunner', () => {
  it('runTask rejects a non-positive timeout without spawning anything', async () => {
    const runner = newRunner();
    await expect(runner.runTask({ command: 'script.js', timeout: 0 })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('runTask throws K6_NOT_FOUND when the k6 binary is missing, without crashing', async () => {
    const runner = newRunner();
    const versionProcess = new FakeChildProcess();
    spawnQueue.push(versionProcess);

    const runPromise = runner.runTask({ command: 'script.js' });
    versionProcess.emit('error', Object.assign(new Error('spawn k6 ENOENT'), { code: 'ENOENT' }));

    await expect(runPromise).rejects.toBeInstanceOf(ComputeError);
    await expect(runner.runTask({ command: 'script.js' })).rejects.toMatchObject({ code: 'K6_NOT_FOUND' });
  });

  it('runTask spawns k6 with the script path and returns a taskId immediately', async () => {
    const runner = newRunner();
    const { taskId, process } = await runTaskWithAvailableK6(runner, { command: 'load-test.js' });

    expect(taskId).toMatch(/^[0-9a-f-]{36}$/);
    expect(spawnMock).toHaveBeenLastCalledWith('k6', ['run', '--out', 'json=-', 'load-test.js'], expect.anything());

    const status = await runner.getTaskStatus(taskId);
    expect(status.state).toBe('pending');

    process.emit('spawn');
    process.emit('exit', 0, null);
  });

  it('transitions pending -> running -> completed on a successful run', async () => {
    const runner = newRunner();
    const { taskId, process } = await runTaskWithAvailableK6(runner, { command: 'load-test.js' });

    process.emit('spawn');
    expect((await runner.getTaskStatus(taskId)).state).toBe('running');

    process.stdout.emit('data', Buffer.from('{"type":"Point","data":{"time":"x","value":1}}\n'));
    process.emit('exit', 0, null);

    const finalStatus = await runner.getTaskStatus(taskId);
    expect(finalStatus.state).toBe('completed');
    expect(finalStatus.exitCode).toBe(0);
    expect(finalStatus.completedAt).toBeInstanceOf(Date);
  });

  it('a non-zero exit code produces a "failed" status whose error includes captured stderr', async () => {
    const runner = newRunner();
    const { taskId, process } = await runTaskWithAvailableK6(runner, { command: 'load-test.js' });

    process.emit('spawn');
    process.stderr.emit('data', Buffer.from('ERRO[0000] script threw an exception\n'));
    process.emit('exit', 1, null);

    const status = await runner.getTaskStatus(taskId);
    expect(status.state).toBe('failed');
    expect(status.exitCode).toBe(1);
    expect(status.error).toContain('script threw an exception');
  });

  it('a spawn-time error (binary removed after the availability check) marks the task failed', async () => {
    const runner = newRunner();
    const versionProcess = new FakeChildProcess();
    const taskProcess = new FakeChildProcess();
    spawnQueue.push(versionProcess, taskProcess);

    const runPromise = runner.runTask({ command: 'load-test.js' });
    versionProcess.emit('exit', 0);
    const taskId = await runPromise;

    taskProcess.emit('error', new Error('spawn k6 ENOENT'));

    const status = await runner.getTaskStatus(taskId);
    expect(status.state).toBe('failed');
    expect(status.error).toContain('Failed to start k6 process');
  });

  it('malformed JSON-lines are skipped without crashing the task, valid lines still processed', async () => {
    const runner = newRunner();
    const { taskId, process } = await runTaskWithAvailableK6(runner, { command: 'load-test.js' });

    process.emit('spawn');
    const raw = await readFile(join(FIXTURES_DIR, 'malformed-output.jsonl'), 'utf-8');
    process.stdout.emit('data', Buffer.from(raw));
    process.emit('exit', 0, null);

    const status = await runner.getTaskStatus(taskId);
    expect(status.state).toBe('completed');
  });

  it('getTaskStatus throws TASK_NOT_FOUND for an unknown taskId', async () => {
    const runner = newRunner();
    await expect(runner.getTaskStatus('does-not-exist')).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
  });

  it('stopTask sends SIGTERM and transitions the task to "stopped"', async () => {
    const runner = newRunner();
    const { taskId, process } = await runTaskWithAvailableK6(runner, { command: 'load-test.js' });
    process.emit('spawn');

    await runner.stopTask(taskId);
    expect(process.killSignals).toContain('SIGTERM');

    process.emit('exit', null, 'SIGTERM');
    const status = await runner.getTaskStatus(taskId);
    expect(status.state).toBe('stopped');
  });

  it('stopTask on an already-completed task is a no-op that does not throw', async () => {
    const runner = newRunner();
    const { taskId, process } = await runTaskWithAvailableK6(runner, { command: 'load-test.js' });
    process.emit('spawn');
    process.emit('exit', 0, null);
    expect((await runner.getTaskStatus(taskId)).state).toBe('completed');

    await expect(runner.stopTask(taskId)).resolves.toBeUndefined();
    expect(process.killSignals).toHaveLength(0);
  });

  it('stopTask on an unknown taskId throws TASK_NOT_FOUND', async () => {
    const runner = newRunner();
    await expect(runner.stopTask('does-not-exist')).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
  });

  it('SIGTERM to an already-exited process does not throw (safeKill is defensive)', async () => {
    const runner = newRunner();
    const { taskId, process } = await runTaskWithAvailableK6(runner, { command: 'load-test.js' });
    process.emit('spawn');
    process.kill = () => {
      throw new Error('ESRCH: no such process');
    };

    await expect(runner.stopTask(taskId)).resolves.toBeUndefined();
    process.emit('exit', null, 'SIGTERM');
    expect((await runner.getTaskStatus(taskId)).state).toBe('stopped');
  });

  it('timeout triggers SIGTERM, then SIGKILL after the grace period if still running', async () => {
    vi.useFakeTimers();
    const runner = newRunner({ timeoutMs: 1000, graceMs: 500 });

    const versionProcess = new FakeChildProcess();
    const taskProcess = new FakeChildProcess();
    spawnQueue.push(versionProcess, taskProcess);
    const runPromise = runner.runTask({ command: 'load-test.js' });
    versionProcess.emit('exit', 0);
    const taskId = await runPromise;
    taskProcess.emit('spawn');

    await vi.advanceTimersByTimeAsync(1000);
    expect(taskProcess.killSignals).toEqual(['SIGTERM']);

    await vi.advanceTimersByTimeAsync(500);
    expect(taskProcess.killSignals).toEqual(['SIGTERM', 'SIGKILL']);

    taskProcess.emit('exit', null, 'SIGKILL');
    const status = await runner.getTaskStatus(taskId);
    expect(status.state).toBe('failed');
    expect(status.error).toContain('timeout');
  });

  it('a process that exits before the grace period fires after SIGTERM does not also get SIGKILL', async () => {
    vi.useFakeTimers();
    const runner = newRunner({ timeoutMs: 1000, graceMs: 500 });

    const versionProcess = new FakeChildProcess();
    const taskProcess = new FakeChildProcess();
    spawnQueue.push(versionProcess, taskProcess);
    const runPromise = runner.runTask({ command: 'load-test.js' });
    versionProcess.emit('exit', 0);
    const taskId = await runPromise;
    taskProcess.emit('spawn');

    await vi.advanceTimersByTimeAsync(1000);
    expect(taskProcess.killSignals).toEqual(['SIGTERM']);

    taskProcess.emit('exit', null, 'SIGTERM');
    await vi.advanceTimersByTimeAsync(500);
    expect(taskProcess.killSignals).toEqual(['SIGTERM']);

    expect((await runner.getTaskStatus(taskId)).state).toBe('failed');
  });

  it('handles multiple concurrent tasks independently', async () => {
    const runner = newRunner();
    const first = await runTaskWithAvailableK6(runner, { command: 'a.js' });

    // The k6 availability check is cached on the runner instance after the
    // first runTask() call, so this second call only spawns the task
    // process itself — no second 'version' probe.
    const secondProcess = new FakeChildProcess();
    spawnQueue.push(secondProcess);
    const secondTaskId = await runner.runTask({ command: 'b.js' });

    first.process.emit('spawn');
    first.process.emit('exit', 0, null);
    secondProcess.emit('spawn');
    secondProcess.emit('exit', 1, null);

    expect((await runner.getTaskStatus(first.taskId)).state).toBe('completed');
    expect((await runner.getTaskStatus(secondTaskId)).state).toBe('failed');
  });

  it('a process that hangs and never exits still reports a timeout via getTaskStatus', async () => {
    vi.useFakeTimers();
    const runner = newRunner({ timeoutMs: 1000, graceMs: 500 });
    const versionProcess = new FakeChildProcess();
    const taskProcess = new FakeChildProcess();
    spawnQueue.push(versionProcess, taskProcess);
    const runPromise = runner.runTask({ command: 'load-test.js' });
    versionProcess.emit('exit', 0);
    const taskId = await runPromise;
    taskProcess.emit('spawn');

    await vi.advanceTimersByTimeAsync(1000);
    const status = await runner.getTaskStatus(taskId);
    expect(status.error).toContain('timeout');
    expect(status.state).toBe('running'); // no 'exit' ever fired — state only flips once the process actually exits
  });

  describe('init()', () => {
    it('logs a warning (does not throw) when k6 is not found', async () => {
      const runner = newRunner();
      const versionProcess = new FakeChildProcess();
      spawnQueue.push(versionProcess);

      const initPromise = runner.init();
      versionProcess.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      await expect(initPromise).resolves.toBeUndefined();
    });

    it('resolves cleanly when k6 is available', async () => {
      const runner = newRunner();
      const versionProcess = new FakeChildProcess();
      spawnQueue.push(versionProcess);

      const initPromise = runner.init();
      versionProcess.emit('exit', 0);
      await expect(initPromise).resolves.toBeUndefined();
    });
  });
});
