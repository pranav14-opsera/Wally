import { Writable } from 'node:stream';

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { ConsoleAuditLogger } from '../../../src/logging/console-audit-logger.js';
import {
  createAccessControlAuditEvent,
  createAuthAuditEvent,
  createMutationAuditEvent,
} from '../../fixtures/log-events.fixture.js';

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

describe('ConsoleAuditLogger', () => {
  it('logAuthEvent produces output with audit:true and all AuthAuditEvent fields', () => {
    const { stream, lines } = createCaptureStream();
    const logger = new ConsoleAuditLogger(pino(stream));
    const event = createAuthAuditEvent();

    logger.logAuthEvent(event);

    const [entry] = lines() as Array<Record<string, unknown>>;
    expect(entry?.audit).toBe(true);
    expect(entry?.eventType).toBe('auth');
    expect(entry?.actor).toBe(event.actor);
    expect(entry?.action).toBe(event.action);
    expect(entry?.ip).toBe(event.ip);
    expect(entry?.userAgent).toBe(event.userAgent);
    expect(entry?.success).toBe(event.success);
  });

  it('logMutationEvent includes changeDetails', () => {
    const { stream, lines } = createCaptureStream();
    const logger = new ConsoleAuditLogger(pino(stream));
    const event = createMutationAuditEvent();

    logger.logMutationEvent(event);

    const [entry] = lines() as Array<{ audit: boolean; changeDetails: unknown }>;
    expect(entry?.audit).toBe(true);
    expect(entry?.changeDetails).toEqual(event.changeDetails);
  });

  it('logAccessControlEvent includes requiredRole and actualRole', () => {
    const { stream, lines } = createCaptureStream();
    const logger = new ConsoleAuditLogger(pino(stream));
    const event = createAccessControlAuditEvent();

    logger.logAccessControlEvent(event);

    const [entry] = lines() as Array<{ requiredRole: string; actualRole: string }>;
    expect(entry?.requiredRole).toBe(event.requiredRole);
    expect(entry?.actualRole).toBe(event.actualRole);
  });

  it('logs the failure at error level and re-throws when writing an audit event fails', () => {
    const { stream, lines } = createCaptureStream();
    const underlyingLogger = pino(stream);
    const failingLogger = new ConsoleAuditLogger(underlyingLogger);

    const infoSpy = vi.spyOn(underlyingLogger, 'info').mockImplementation(() => {
      throw new Error('write failed');
    });

    expect(() => failingLogger.logAuthEvent(createAuthAuditEvent())).toThrow('write failed');

    const entries = lines() as Array<{ audit: boolean; eventType: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.audit).toBe(true);
    expect(entries[0]?.eventType).toBe('auth');

    infoSpy.mockRestore();
  });
});
