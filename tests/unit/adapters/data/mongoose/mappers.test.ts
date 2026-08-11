import { describe, expect, it } from 'vitest';

import {
  mapEmbeddedDriftEvent,
  mapEmbeddedJobStep,
  toDomainEntities,
  toDomainEntity,
} from '../../../../../src/adapters/data/mongoose/mappers.js';

describe('toDomainEntity', () => {
  it('maps _id to id and drops __v', () => {
    const leanDoc = { _id: 'u-1', name: 'Ada', __v: 0 };
    expect(toDomainEntity(leanDoc)).toEqual({ id: 'u-1', name: 'Ada' });
  });

  it('preserves all other fields unchanged', () => {
    const leanDoc = { _id: 'u-1', email: 'a@example.com', is_locked: false, __v: 3 };
    expect(toDomainEntity(leanDoc)).toEqual({ id: 'u-1', email: 'a@example.com', is_locked: false });
  });
});

describe('toDomainEntities', () => {
  it('maps an array of lean documents', () => {
    const docs = [
      { _id: 'a', name: 'x', __v: 0 },
      { _id: 'b', name: 'y', __v: 0 },
    ];
    expect(toDomainEntities(docs)).toEqual([
      { id: 'a', name: 'x' },
      { id: 'b', name: 'y' },
    ]);
  });

  it('returns an empty array for an empty input', () => {
    expect(toDomainEntities([])).toEqual([]);
  });
});

describe('mapEmbeddedJobStep', () => {
  it('maps _id to id and injects the parent job_id', () => {
    const leanStep = { _id: 'step-1', step_order: 1, step_name: 'validate', status: 'pending' };
    expect(mapEmbeddedJobStep(leanStep, 'job-1')).toEqual({
      id: 'step-1',
      job_id: 'job-1',
      step_order: 1,
      step_name: 'validate',
      status: 'pending',
    });
  });
});

describe('mapEmbeddedDriftEvent', () => {
  it('maps _id to id and injects the parent job_id', () => {
    const leanEvent = { _id: 'drift-1', metric_id: 'm-1', source_value: 10, dashboard_value: 12 };
    expect(mapEmbeddedDriftEvent(leanEvent, 'job-1')).toEqual({
      id: 'drift-1',
      job_id: 'job-1',
      metric_id: 'm-1',
      source_value: 10,
      dashboard_value: 12,
    });
  });
});
