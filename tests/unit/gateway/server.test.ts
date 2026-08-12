import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runServer } from '../../../src/gateway/server.js';
import type { GatewayContainer } from '../../../src/gateway/types.js';

function fakeContainer(shutdownTimeoutMs = 10_000): GatewayContainer {
  return {
    config: { PORT: 3000, HOST: '0.0.0.0', SHUTDOWN_TIMEOUT_MS: shutdownTimeoutMs } as GatewayContainer['config'],
    logger: pino({ level: 'silent' }),
  } as GatewayContainer;
}

function fakeApp(closeImpl: () => Promise<void> = async () => {}) {
  return {
    listen: vi.fn(async () => undefined),
    close: vi.fn(closeImpl),
  } as unknown as Parameters<typeof runServer>[1];
}

describe('runServer', () => {
  afterEach(() => {
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');
    vi.restoreAllMocks();
  });

  it('starts listening on the configured port and host', async () => {
    const app = fakeApp();

    await runServer(fakeContainer(), app);

    expect(app.listen).toHaveBeenCalledWith({ port: 3000, host: '0.0.0.0' });
  });

  it('drains via app.close() and exits when SIGTERM is received', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const app = fakeApp();

    await runServer(fakeContainer(), app);
    process.emit('SIGTERM');
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));

    expect(app.close).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — a second SIGTERM while shutting down does not call close twice', async () => {
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    let resolveClose: () => void = () => {};
    const app = fakeApp(() => new Promise((resolve) => { resolveClose = resolve; }));

    await runServer(fakeContainer(), app);
    process.emit('SIGTERM');
    process.emit('SIGTERM');
    resolveClose();
    await vi.waitFor(() => expect(app.close).toHaveBeenCalledTimes(1));
  });

  it('force-exits after the shutdown timeout even if close() never resolves', async () => {
    vi.useFakeTimers();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const app = fakeApp(() => new Promise(() => {}));

    await runServer(fakeContainer(50), app);
    process.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(60);

    expect(exitSpy).toHaveBeenCalledWith(0);
    vi.useRealTimers();
  });
});
