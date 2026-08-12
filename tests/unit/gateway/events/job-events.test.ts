import { describe, expect, it, vi } from 'vitest';

import { JobEventBus } from '../../../../src/gateway/events/job-events.js';

describe('JobEventBus', () => {
  it('delivers a published event only to subscribers of that jobId', () => {
    const bus = new JobEventBus();
    const jobAHandler = vi.fn();
    const jobBHandler = vi.fn();
    bus.subscribe('job-a', jobAHandler);
    bus.subscribe('job-b', jobBHandler);

    bus.publish('job-a', { type: 'status', status: 'running' });

    expect(jobAHandler).toHaveBeenCalledWith({ type: 'status', status: 'running' });
    expect(jobBHandler).not.toHaveBeenCalled();
  });

  it('supports multiple concurrent subscribers for the same jobId', () => {
    const bus = new JobEventBus();
    const first = vi.fn();
    const second = vi.fn();
    bus.subscribe('job-a', first);
    bus.subscribe('job-a', second);

    bus.publish('job-a', { type: 'completed', result: { ok: true } });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops delivering events after unsubscribe', () => {
    const bus = new JobEventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe('job-a', handler);

    unsubscribe();
    bus.publish('job-a', { type: 'status', status: 'running' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('publishing to a jobId with no subscribers does not throw', () => {
    const bus = new JobEventBus();
    expect(() => bus.publish('no-subscribers', { type: 'status', status: 'running' })).not.toThrow();
  });
});
