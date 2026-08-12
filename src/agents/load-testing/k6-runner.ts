import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Logger } from 'pino';

import type { LoadTestProfile } from './schemas.js';

export interface K6RunResult {
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  throughputRps: number;
  errorRatePct: number;
  rawMetrics: Record<string, unknown>;
}

function buildScript(profile: LoadTestProfile): string {
  // `summaryTrendStats` explicitly includes p(99) — k6's own default
  // summary stats are only avg/min/med/max/p(90)/p(95), so without this
  // the exported summary JSON has no p99 field at all for any Trend
  // metric (http_req_duration included).
  return `import http from 'k6/http';
export const options = {
  vus: ${profile.vus},
  duration: '${profile.durationSeconds}s',
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};
export default function () { http.get(${JSON.stringify(profile.targetUrl)}); }
`;
}

function spawnK6(
  binaryPath: string,
  args: string[],
  timeoutMs: number,
  progressIntervalMs: number,
  stderrTailLength: number,
  logger: Logger,
  onProgress: (elapsedSeconds: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args);
    const startedAt = Date.now();
    let stderr = '';

    const progressTimer = setInterval(() => {
      // eslint-disable-next-line wally/no-hardcoded-config -- 1000 is the fixed ms-per-second unit conversion, not a configurable value
      onProgress(Math.round((Date.now() - startedAt) / 1000));
    }, progressIntervalMs);
    progressTimer.unref();

    const timeoutTimer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`k6 run exceeded the ${timeoutMs}ms timeout and was killed`));
    }, timeoutMs);
    timeoutTimer.unref();

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });

    child.once('error', (error) => {
      clearInterval(progressTimer);
      clearTimeout(timeoutTimer);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new Error(`k6 binary not found at "${binaryPath}" — install k6: https://k6.io/docs/get-started/installation/`),
        );
        return;
      }
      reject(error);
    });

    child.once('exit', (code) => {
      clearInterval(progressTimer);
      clearTimeout(timeoutTimer);
      if (code === 0) {
        resolve();
        return;
      }
      logger.warn({ code, stderr: stderr.slice(-stderrTailLength) }, 'k6 exited non-zero');
      reject(new Error(`k6 exited with code ${code}${stderr ? `: ${stderr.slice(-stderrTailLength)}` : ''}`));
    });
  });
}

/**
 * k6's own summary JSON, keyed by metric name — confirmed against a real
 * k6 v1.2.3 `--summary-export` run (not just k6's docs): stats sit
 * directly on the metric object (`metrics.http_req_duration.med`, NOT
 * `.values.med`), and Rate metrics like `http_req_failed` expose the
 * 0-1 fraction as `.value`, not `.rate` (`.rate` is only a Counter-metric
 * field, e.g. `http_reqs.rate`). Every field read here falls back to 0
 * rather than throwing if it's missing (WO error-handling posture: never
 * crash the whole run over an unexpected metrics shape).
 */
async function readSummary(summaryPath: string): Promise<K6RunResult> {
  const raw = JSON.parse(await readFile(summaryPath, 'utf-8')) as Record<string, unknown>;
  const metrics = (raw.metrics ?? {}) as Record<string, Record<string, number>>;

  const duration = metrics.http_req_duration ?? {};
  const reqs = metrics.http_reqs ?? {};
  const failed = metrics.http_req_failed ?? {};

  return {
    p50LatencyMs: duration.med ?? 0,
    p95LatencyMs: duration['p(95)'] ?? 0,
    p99LatencyMs: duration['p(99)'] ?? 0,
    throughputRps: reqs.rate ?? 0,
    // eslint-disable-next-line wally/no-hardcoded-config -- 100 converts k6's 0-1 fraction to a percentage, a fixed unit conversion, not a configurable value
    errorRatePct: (failed.value ?? 0) * 100,
    rawMetrics: raw,
  };
}

/**
 * Spawns k6 directly rather than through `ICloudComputeService.runTask`
 * (WO-017/local.ts) — that interface returns only a taskId and terminal
 * exit code, with no way to recover the metrics k6 itself measured.
 * `--summary-export` is the flag that gets those metrics back out, and
 * routing it through the generic compute-task abstraction (which appends
 * extra args after the script path) risked it not being parsed as a
 * flag at all depending on the installed k6 version's CLI parser.
 */
export interface RunK6Options {
  k6BinaryPath: string;
  timeoutMs: number;
  progressIntervalMs: number;
  stderrTailLength: number;
}

export async function runK6(
  profile: LoadTestProfile,
  options: RunK6Options,
  logger: Logger,
  onProgress: (elapsedSeconds: number) => void,
): Promise<K6RunResult> {
  const workDir = await mkdtemp(join(tmpdir(), 'wally-loadtest-'));
  const scriptPath = join(workDir, 'script.js');
  const summaryPath = join(workDir, 'summary.json');
  await writeFile(scriptPath, buildScript(profile), 'utf-8');

  try {
    await spawnK6(
      options.k6BinaryPath,
      ['run', '--summary-export', summaryPath, scriptPath],
      options.timeoutMs,
      options.progressIntervalMs,
      options.stderrTailLength,
      logger,
      onProgress,
    );
    return await readSummary(summaryPath);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
