import { describe, expectTypeOf, it } from 'vitest';

import type {
  AgentJob,
  AgentJobWithDriftEvents,
  AgentJobWithSteps,
  BaseEntity,
  FilterOptions,
  IAgentJobRepository,
  IRepository,
  PaginatedResult,
  SortOptions,
  User,
} from '../../src/adapters/data/index.js';

describe('IRepository<T> type-level contract', () => {
  it('constrains T to BaseEntity — a type missing id/created_at/updated_at is rejected', () => {
    expectTypeOf<IRepository<User>>().toMatchTypeOf<IRepository<BaseEntity>>();

    // A shape without BaseEntity's fields must NOT be assignable as T.
    interface NotAnEntity {
      name: string;
    }
    // @ts-expect-error NotAnEntity doesn't extend BaseEntity
    type _Invalid = IRepository<NotAnEntity>;
  });

  it('findMany returns PaginatedResult<T>, not a bare array', () => {
    expectTypeOf<IRepository<User>['findMany']>().returns.resolves.toEqualTypeOf<
      PaginatedResult<User>
    >();
  });

  it('create/createMany omit id/created_at/updated_at from their input type', () => {
    expectTypeOf<IRepository<User>['create']>().parameter(0).toEqualTypeOf<
      Omit<User, 'id' | 'created_at' | 'updated_at'>
    >();
    expectTypeOf<IRepository<User>['createMany']>()
      .parameter(0)
      .toEqualTypeOf<Array<Omit<User, 'id' | 'created_at' | 'updated_at'>>>();
  });

  it('update accepts a Partial of the entity minus id/created_at/updated_at', () => {
    expectTypeOf<IRepository<User>['update']>().parameter(1).toEqualTypeOf<
      Partial<Omit<User, 'id' | 'created_at' | 'updated_at'>>
    >();
  });

  it('FilterOptions/SortOptions are keyed by the entity fields', () => {
    expectTypeOf<FilterOptions<User>>().toHaveProperty('email');
    expectTypeOf<FilterOptions<User>>().toHaveProperty('role');
    expectTypeOf<SortOptions<User>>().toHaveProperty('created_at');
  });

  it('IAgentJobRepository extends IRepository<AgentJob> with composite-query methods', () => {
    expectTypeOf<IAgentJobRepository>().toMatchTypeOf<IRepository<AgentJob>>();
    expectTypeOf<IAgentJobRepository['findByIdWithSteps']>().returns.resolves.toEqualTypeOf<
      AgentJobWithSteps | null
    >();
    expectTypeOf<IAgentJobRepository['findByIdWithDriftEvents']>().returns.resolves.toEqualTypeOf<
      AgentJobWithDriftEvents | null
    >();
  });

  it('generic constraint compiles identically across two different entity shapes', () => {
    interface WidgetEntity extends BaseEntity {
      widgetName: string;
    }

    expectTypeOf<IRepository<User>['findById']>().returns.resolves.toEqualTypeOf<User | null>();
    expectTypeOf<IRepository<WidgetEntity>['findById']>().returns.resolves.toEqualTypeOf<
      WidgetEntity | null
    >();
  });
});
