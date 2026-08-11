import { Writable } from 'node:stream';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { createRequestLogger } from '../../../src/logging/request-logger.js';

function createCaptureStream(): { stream: Writable; lines: () => unknown[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });

  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as unknown),
  };
}

describe('createRequestLogger', () => {
  it('binds requestId, actorId, resource, and operation to the child logger', () => {
    const { stream, lines } = createCaptureStream();
    const baseLogger = pino(stream);

    const requestLogger = createRequestLogger(baseLogger, {
      requestId: 'req-1',
      actorId: 'user-42',
      resource: 'tool-registry',
      operation: 'list',
    });
    requestLogger.info('handled request');

    const [entry] = lines() as Array<{
      requestId: string;
      actorId: string;
      resource: string;
      operation: string;
    }>;
    expect(entry?.requestId).toBe('req-1');
    expect(entry?.actorId).toBe('user-42');
    expect(entry?.resource).toBe('tool-registry');
    expect(entry?.operation).toBe('list');
  });

  it('works with only the required requestId field', () => {
    const { stream, lines } = createCaptureStream();
    const baseLogger = pino(stream);

    const requestLogger = createRequestLogger(baseLogger, { requestId: 'req-2' });
    requestLogger.info('handled request');

    const [entry] = lines() as Array<{ requestId: string }>;
    expect(entry?.requestId).toBe('req-2');
  });

  it('is a genuine child logger that inherits the parent level', () => {
    const { stream, lines } = createCaptureStream();
    const baseLogger = pino({ level: 'warn' }, stream);

    const requestLogger = createRequestLogger(baseLogger, { requestId: 'req-3' });
    requestLogger.info('should be suppressed by inherited warn level');
    requestLogger.warn('should appear');

    const entries = lines() as Array<{ msg: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.msg).toBe('should appear');
  });
});
