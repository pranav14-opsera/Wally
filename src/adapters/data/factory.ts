import type { DataEngine } from '../../config/schema.js';
import { AdapterNotRegisteredError } from '../errors.js';
import type { IRepository } from './interfaces.js';
import { StubRepository } from './stubs/stub-repository.js';

/**
 * A data engine resolves to a *repository factory* (not a single
 * `IRepository` instance) because `IRepository<T>` is generic per entity —
 * `createDataAdapter(engine)` binds the engine choice once, and the
 * returned factory is then called per entity name (see
 * `AppContainer.createRepository` in src/container.ts).
 */
export type RepositoryFactory = <T extends { id: string }>(entityName: string) => IRepository<T>;

class DataAdapterRegistry {
  private readonly factories = new Map<string, RepositoryFactory>();

  public register(engine: string, factory: RepositoryFactory): void {
    this.factories.set(engine, factory);
  }

  public resolve(engine: string): RepositoryFactory {
    const factory = this.factories.get(engine);
    if (!factory) {
      throw new AdapterNotRegisteredError('data', engine, [...this.factories.keys()]);
    }
    return factory;
  }
}

export const dataAdapterRegistry = new DataAdapterRegistry();

const stubRepositoryFactory: RepositoryFactory = (entityName) => new StubRepository(entityName);

// StubRepository is registered for both engines as a placeholder until the
// real Prisma (postgres) and Mongoose (mongo) adapters are built in their
// own epics — swapping either key to a real implementation requires no
// changes outside this file.
dataAdapterRegistry.register('postgres', stubRepositoryFactory);
dataAdapterRegistry.register('mongo', stubRepositoryFactory);

export function createDataAdapter(engine: DataEngine): RepositoryFactory {
  return dataAdapterRegistry.resolve(engine);
}
