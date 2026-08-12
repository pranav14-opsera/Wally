import type { IRepository, User } from '../../adapters/data/index.js';

/**
 * The auth module's user-data dependency (WO-042 AC6). Wally's Data
 * Adapter epic (WO-007) already established `IRepository<User>` as the
 * one true user-access interface — both `PrismaRepository` and
 * `MongooseRepository` satisfy it identically — so this is a named alias
 * for that interface rather than a second, parallel repository
 * abstraction the Data Adapter would need its own implementation of.
 */
export type IUserRepository = IRepository<User>;

export async function findUserByEmail(users: IUserRepository, email: string): Promise<User | null> {
  const result = await users.findMany({ email: { operator: 'eq', value: email } }, undefined, {
    kind: 'offset',
    limit: 1,
    offset: 0,
  });
  return result.items[0] ?? null;
}
