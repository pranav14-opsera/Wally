/**
 * Thrown by an adapter factory when the requested provider/engine key has
 * no registered implementation (e.g. `CLOUD_PROVIDER=gcp` before the GCP
 * adapter is built). Shared across `adapters/cloud/factory.ts` and
 * `adapters/data/factory.ts` so both report this failure the same way.
 */
export class AdapterNotRegisteredError extends Error {
  public constructor(category: string, requested: string, available: readonly string[]) {
    super(
      `No ${category} adapter registered for "${requested}". Available: ${
        available.length > 0 ? available.join(', ') : '(none registered)'
      }`,
    );
    this.name = 'AdapterNotRegisteredError';
  }
}
