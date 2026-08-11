import { describe, expect, it } from 'vitest';

import { toDomainEntity } from '../../../../../src/adapters/data/prisma/mappers.js';

interface Sample {
  id: string;
  name: string;
}

describe('toDomainEntity', () => {
  it('returns the same data, retyped — Prisma results and domain entities share field names', () => {
    const prismaRecord = { id: 'x-1', name: 'Ada' };
    const entity = toDomainEntity<Sample>(prismaRecord);
    expect(entity).toEqual({ id: 'x-1', name: 'Ada' });
  });

  it('does not clone or otherwise transform the object — same reference', () => {
    const prismaRecord = { id: 'x-1', name: 'Ada' };
    const entity = toDomainEntity<Sample>(prismaRecord);
    expect(entity).toBe(prismaRecord as unknown as Sample);
  });
});
