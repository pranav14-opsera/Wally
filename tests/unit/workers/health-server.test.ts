import { request } from 'node:http';

import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';

import { HealthServer } from '../../../src/workers/health-server.js';

const silentLogger = pino({ level: 'silent' });
const TEST_PORT = 18_734;

function getHealth(port: number): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: 'localhost', port, path: '/', method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('HealthServer', () => {
  let server: HealthServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it('returns 200 with status "ok" while isHealthy() reports true', async () => {
    server = new HealthServer(TEST_PORT, () => true, silentLogger);
    server.start();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const response = await getHealth(TEST_PORT);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'ok' });
  });

  it('returns 503 with status "shutting-down" once isHealthy() reports false', async () => {
    let healthy = true;
    server = new HealthServer(TEST_PORT, () => healthy, silentLogger);
    server.start();
    await new Promise((resolve) => setTimeout(resolve, 50));

    healthy = false;
    const response = await getHealth(TEST_PORT);
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toEqual({ status: 'shutting-down' });
  });

  it('stop() completes without error when the server was never started', async () => {
    const neverStarted = new HealthServer(TEST_PORT, () => true, silentLogger);
    await expect(neverStarted.stop()).resolves.toBeUndefined();
  });

  it('stop() closes the port — a subsequent request fails to connect', async () => {
    server = new HealthServer(TEST_PORT, () => true, silentLogger);
    server.start();
    await new Promise((resolve) => setTimeout(resolve, 50));

    await server.stop();
    await expect(getHealth(TEST_PORT)).rejects.toThrow();
  });

  it('stop() is idempotent — calling it twice does not throw', async () => {
    server = new HealthServer(TEST_PORT, () => true, silentLogger);
    server.start();
    await new Promise((resolve) => setTimeout(resolve, 50));

    await server.stop();
    await expect(server.stop()).resolves.toBeUndefined();
  });
});
