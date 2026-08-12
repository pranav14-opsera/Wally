import { ProviderNotImplementedError } from './interfaces/index.js';

/**
 * Builds one stub method for a provider adapter (WO-021). The returned
 * function accepts any arguments — TypeScript's structural typing lets a
 * `(...args: unknown[]) => Promise<never>` satisfy any narrower interface
 * method signature (rest `unknown[]` is compatible with any parameter list,
 * `Promise<never>` is assignable to any `Promise<T>`) — so every stub class
 * gets full interface compliance without repeating a throw body per method.
 */
export function createStubMethod(
  provider: string,
  methodName: string,
  backingService: string,
): (...args: unknown[]) => Promise<never> {
  return async (): Promise<never> => {
    throw new ProviderNotImplementedError(provider, methodName, backingService);
  };
}
