import { describe, expect, it } from 'vitest';

import { InvalidStateTransitionError } from '../../../src/agents/errors.js';
import { assertTransition, canTransition } from '../../../src/agents/state-machine.js';
import type { JobStatus } from '../../../src/adapters/data/enums.js';

describe('state-machine', () => {
  describe('canTransition', () => {
    it.each([
      ['queued', 'running', true],
      ['queued', 'cancelled', true],
      ['queued', 'completed', false],
      ['queued', 'paused', false],
      ['running', 'completed', true],
      ['running', 'failed', true],
      ['running', 'paused', true],
      ['running', 'cancelled', true],
      ['running', 'queued', false],
      ['paused', 'running', true],
      ['paused', 'cancelled', true],
      ['paused', 'completed', false],
      ['completed', 'running', false],
      ['completed', 'failed', false],
      ['failed', 'running', false],
      ['cancelled', 'running', false],
    ] as Array<[JobStatus, JobStatus, boolean]>)('canTransition(%s, %s) === %s', (from, to, expected) => {
      expect(canTransition(from, to)).toBe(expected);
    });
  });

  describe('assertTransition', () => {
    it('does not throw for a valid transition', () => {
      expect(() => assertTransition('queued', 'running')).not.toThrow();
    });

    it('throws InvalidStateTransitionError for an invalid transition, listing valid targets', () => {
      let thrown: InvalidStateTransitionError | undefined;
      try {
        assertTransition('completed', 'running');
        expect.unreachable();
      } catch (error) {
        thrown = error as InvalidStateTransitionError;
      }

      expect(thrown).toBeInstanceOf(InvalidStateTransitionError);
      expect(thrown?.from).toBe('completed');
      expect(thrown?.to).toBe('running');
      expect(thrown?.message).toContain('terminal state');
    });

    it('lists valid transitions in the error message for a non-terminal source state', () => {
      expect(() => assertTransition('queued', 'completed')).toThrow(/running.*cancelled/);
    });
  });
});
