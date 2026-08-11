import { describe, expect, it } from 'vitest';

import { baseSchemaOptions, defaultStringId, TIMESTAMPS_OPTION } from '../../../../../src/adapters/data/mongoose/schema-utils.js';

describe('defaultStringId', () => {
  it('generates a UUID-format string', () => {
    const id = defaultStringId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('generates a different value on each call', () => {
    expect(defaultStringId()).not.toBe(defaultStringId());
  });
});

describe('baseSchemaOptions', () => {
  it('maps timestamps to created_at/updated_at, not Mongoose default camelCase', () => {
    expect(baseSchemaOptions().timestamps).toEqual(TIMESTAMPS_OPTION);
    expect(TIMESTAMPS_OPTION).toEqual({ createdAt: 'created_at', updatedAt: 'updated_at' });
  });

  it('enables virtuals and disables the version key on both toJSON and toObject', () => {
    const options = baseSchemaOptions();
    expect(options.toJSON).toEqual({ virtuals: true, versionKey: false });
    expect(options.toObject).toEqual({ virtuals: true, versionKey: false });
  });

  it('returns a fresh object on each call (not a shared mutable reference)', () => {
    expect(baseSchemaOptions()).not.toBe(baseSchemaOptions());
  });
});
