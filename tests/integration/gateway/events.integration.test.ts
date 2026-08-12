import { randomUUID } from 'node:crypto';
import http from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../../src/gateway/app.js';
import { jobEventBus } from '../../../src/gateway/events/job-events.js';
import { fakeGatewayContainer } from '../../helpers/fake-gateway-container.js';

async function appOnEphemeralPort() {
  const app = await buildApp(fakeGatewayContainer());
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { app, port };
}

interface SseReadResult {
  statusCode: number;
  chunks: string[];
}

function readSseChunks(port: number, path: string, token: string, maxChunks: number): Promise<SseReadResult> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    const req = http.get({ host: '127.0.0.1', port, path, headers: { Authorization: `Bearer ${token}` } }, (res) => {
      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk.toString('utf-8'));
        if (chunks.length >= maxChunks) {
          req.destroy();
          resolve({ statusCode: res.statusCode ?? 0, chunks });
        }
      });
      res.on('error', reject);
    });
    req.on('error', (error) => {
      if (chunks.length > 0) {
        resolve({ statusCode: 200, chunks });
        return;
      }
      reject(error);
    });
  });
}

describe('SSE job events endpoint (integration)', () => {
  let app: Awaited<ReturnType<typeof appOnEphemeralPort>>['app'] | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('streams published job events as they happen', async () => {
    const built = await appOnEphemeralPort();
    app = built.app;
    const jobId = randomUUID();
    const token = app.jwt.generateAccessToken('viewer-1', 'viewer@test.com', 'viewer');

    const streamPromise = readSseChunks(built.port, `/api/v1/events/jobs/${jobId}`, token, 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    jobEventBus.publish(jobId, { type: 'status', status: 'running' });

    const { statusCode, chunks } = await streamPromise;
    expect(statusCode).toBe(200);
    expect(chunks.join('')).toContain('"type":"status"');
    expect(chunks.join('')).toContain('"status":"running"');
  });

  it('rejects an unauthenticated SSE connection with 401', async () => {
    const built = await appOnEphemeralPort();
    app = built.app;

    await new Promise<void>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: built.port, path: `/api/v1/events/jobs/${randomUUID()}` }, (res) => {
        try {
          expect(res.statusCode).toBe(401);
          resolve();
        } catch (error) {
          reject(error as Error);
        } finally {
          res.destroy();
        }
      }).on('error', reject);
    });
  });
});
