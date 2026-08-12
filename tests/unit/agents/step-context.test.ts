import { describe, expect, it } from 'vitest';

import { StepContext } from '../../../src/agents/step-context.js';

describe('StepContext', () => {
  it('exposes the original job input via .input', () => {
    const context = new StepContext({ seed: 42 });
    expect(context.input).toEqual({ seed: 42 });
  });

  it('has() is false before set(), true after', () => {
    const context = new StepContext({});
    expect(context.has('step-a')).toBe(false);
    context.set('step-a', 1);
    expect(context.has('step-a')).toBe(true);
  });

  it('get() returns the value recorded by set(), typed via the generic parameter', () => {
    const context = new StepContext({});
    context.set('step-a', { total: 5 });
    expect(context.get<{ total: number }>('step-a')).toEqual({ total: 5 });
  });

  it('get() throws a descriptive error for a step that has not run yet', () => {
    const context = new StepContext({});
    context.set('step-a', 1);
    expect(() => context.get('step-never-ran')).toThrow(/step-never-ran/);
    expect(() => context.get('step-never-ran')).toThrow(/step-a/);
  });

  it('get() lists "(none)" when no steps have recorded a result yet', () => {
    const context = new StepContext({});
    expect(() => context.get('anything')).toThrow(/\(none\)/);
  });

  it('set() stores undefined as a valid, present value — distinct from never having been set', () => {
    const context = new StepContext({});
    context.set('step-a', undefined);
    expect(context.has('step-a')).toBe(true);
    expect(context.get('step-a')).toBeUndefined();
  });

  it('toObject() snapshots every recorded result keyed by step name', () => {
    const context = new StepContext({});
    context.set('step-a', 1);
    context.set('step-b', 'two');
    expect(context.toObject()).toEqual({ 'step-a': 1, 'step-b': 'two' });
  });

  it('toObject() on a fresh context returns an empty object', () => {
    const context = new StepContext({});
    expect(context.toObject()).toEqual({});
  });
});
