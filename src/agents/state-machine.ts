import type { JobStatus } from '../adapters/data/enums.js';
import { InvalidStateTransitionError } from './errors.js';

/**
 * The AC's required transitions are queued->running->completed|failed|paused
 * and paused->running. 'cancelled' is part of JobStatus itself
 * (src/adapters/data/enums.ts, predates this WO) but has no AC-specified
 * transition rules — treated here as reachable from any non-terminal
 * state (a user/operator can cancel a queued, running, or paused job) and
 * terminal itself, matching how 'completed'/'failed' behave.
 */
const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['completed', 'failed', 'paused', 'cancelled'],
  paused: ['running', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidStateTransitionError(from, to, TRANSITIONS[from]);
  }
}
