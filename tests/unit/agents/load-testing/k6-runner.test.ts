import { EventEmitter } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runK6 } from '../../../../src/agents/load-testing/k6-runner.js';
import type { LoadTestProfile } from '../../../../src/agents/load-testing/schemas.js';

class FakeChildProcess extends EventEmitter {
  public stderr = new EventEmitter();
  public killed = false;
  public kill(): void {
    this.killed = true;
  }
}

let fakeChild: FakeChildProcess;
let lastSpawnArgs: { binary: string; args: string[] } | undefined;

vi.mock('node:child_process', () => ({
  spawn: (binary: string, args: string[]) => {
    lastSpawnArgs = { binary, args };
    fakeChild = new FakeChildProcess();
    return fakeChild;
  },
}));

const PROFILE: LoadTestProfile = {
  name: 'smoke',
  targetUrl: 'http://localhost:9999/',
  vus: 5,
  durationSeconds: 10,
  thresholds: { p95LatencyMs: 500, errorRatePct: 1 },
};

const OPTIONS = { k6BinaryPath: 'k6', timeoutMs: 5000, progressIntervalMs: 50, stderrTailLength: 200 };
const logger = pino({ level: 'silent' });

describe('runK6', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `lastSpawnArgs`/`fakeChild` are reassigned by the mocked `spawn()`
    // itself, not by a `vi.fn()` — `clearAllMocks()` doesn't touch them.
    // Reset explicitly so `vi.waitFor(() => lastSpawnArgs...)` below
    // waits for THIS test's spawn call instead of passing instantly on a
    // stale value left over from the previous test.
    lastSpawnArgs = undefined;
  });

  it('writes a k6 script referencing the profile and parses the summary export on success', async () => {
    const resultPromise = runK6(PROFILE, OPTIONS, logger, () => {});
    await vi.waitFor(() => expect(lastSpawnArgs).toBeDefined());

    const summaryPath = lastSpawnArgs!.args[2]!;
    const scriptPath = lastSpawnArgs!.args[3]!;
    const scriptContent = await readFile(scriptPath, 'utf-8');
    expect(scriptContent).toContain('http://localhost:9999/');
    expect(scriptContent).toContain("vus: 5,\n  duration: '10s'");
    expect(scriptContent).toContain("p(99)");

    // Real k6 v1.2.3 `--summary-export` shape (verified against a live
    // run, not k6's docs): stats sit directly on the metric object, and
    // Rate metrics expose the 0-1 fraction as `.value`, not `.rate`.
    await writeFile(
      summaryPath,
      JSON.stringify({
        metrics: {
          http_req_duration: { avg: 20, min: 5, med: 12, max: 90, 'p(90)': 40, 'p(95)': 45, 'p(99)': 80 },
          http_reqs: { count: 100, rate: 33.3 },
          http_req_failed: { passes: 2, fails: 98, value: 0.02 },
        },
      }),
      'utf-8',
    );
    fakeChild.emit('exit', 0);

    const result = await resultPromise;
    expect(result).toEqual({
      p50LatencyMs: 12,
      p95LatencyMs: 45,
      p99LatencyMs: 80,
      throughputRps: 33.3,
      errorRatePct: 2,
      rawMetrics: expect.any(Object),
    });
  });

  it('rejects with a clear message when the k6 binary is not found (ENOENT)', async () => {
    const resultPromise = runK6(PROFILE, OPTIONS, logger, () => {});
    await vi.waitFor(() => expect(lastSpawnArgs).toBeDefined());

    const enoent = Object.assign(new Error('spawn k6 ENOENT'), { code: 'ENOENT' });
    fakeChild.emit('error', enoent);

    await expect(resultPromise).rejects.toThrow(/k6 binary not found/);
  });

  it('rejects with stderr context when k6 exits non-zero', async () => {
    const resultPromise = runK6(PROFILE, OPTIONS, logger, () => {});
    await vi.waitFor(() => expect(lastSpawnArgs).toBeDefined());

    fakeChild.stderr.emit('data', Buffer.from('script error: undefined is not a function'));
    fakeChild.emit('exit', 1);

    await expect(resultPromise).rejects.toThrow(/k6 exited with code 1/);
  });

  it('calls onProgress with elapsed seconds while the run is in flight', async () => {
    const onProgress = vi.fn();
    const resultPromise = runK6(PROFILE, { ...OPTIONS, progressIntervalMs: 10 }, logger, onProgress);
    await vi.waitFor(() => expect(lastSpawnArgs).toBeDefined());

    await vi.waitFor(() => expect(onProgress).toHaveBeenCalled());

    const summaryPath = lastSpawnArgs!.args[2]!;
    await writeFile(summaryPath, JSON.stringify({ metrics: {} }), 'utf-8');
    fakeChild.emit('exit', 0);
    await resultPromise;
  });

  it('cleans up its temp working directory after the run finishes', async () => {
    const resultPromise = runK6(PROFILE, OPTIONS, logger, () => {});
    await vi.waitFor(() => expect(lastSpawnArgs).toBeDefined());
    const workDir = join(lastSpawnArgs!.args[3]!, '..');

    await writeFile(lastSpawnArgs!.args[2]!, JSON.stringify({ metrics: {} }), 'utf-8');
    fakeChild.emit('exit', 0);
    await resultPromise;

    await expect(readFile(join(workDir, 'script.js'))).rejects.toThrow();
  });
});
