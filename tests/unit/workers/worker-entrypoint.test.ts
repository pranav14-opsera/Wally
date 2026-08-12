import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { workerBootstrapMock, healthServerStartMock, registerSignalHandlersMock } = vi.hoisted(() => ({
  workerBootstrapMock: vi.fn(),
  healthServerStartMock: vi.fn(),
  registerSignalHandlersMock: vi.fn(),
}));

vi.mock('../../../src/workers/worker-bootstrap.js', () => ({
  workerBootstrap: workerBootstrapMock,
}));

const silentLogger = pino({ level: 'silent' });

let main: () => void;

beforeEach(async () => {
  vi.resetModules();
  workerBootstrapMock.mockReset();
  healthServerStartMock.mockReset();
  registerSignalHandlersMock.mockReset();
  workerBootstrapMock.mockReturnValue({
    workers: [],
    healthServer: { start: healthServerStartMock },
    shutdownHandler: { registerSignalHandlers: registerSignalHandlersMock, shuttingDown: false },
    logger: silentLogger,
  });
  ({ main } = await import('../../../src/workers/worker-entrypoint.js'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('worker-entrypoint main()', () => {
  it('does not self-invoke merely by being imported', () => {
    expect(workerBootstrapMock).not.toHaveBeenCalled();
  });

  it('calls workerBootstrap with a freshly constructed AgentDispatcher', () => {
    main();

    expect(workerBootstrapMock).toHaveBeenCalledTimes(1);
    const dispatcherArg = workerBootstrapMock.mock.calls[0]?.[0];
    expect(dispatcherArg.registeredTypes()).toEqual([]);
  });

  it('starts the health server and registers signal handlers', () => {
    main();

    expect(healthServerStartMock).toHaveBeenCalledTimes(1);
    expect(registerSignalHandlersMock).toHaveBeenCalledTimes(1);
  });
});
