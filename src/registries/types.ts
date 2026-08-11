export interface IRegistry<T> {
  register(key: string, value: T): void;
  get(key: string): T | undefined;
  list(): ReadonlyArray<string>;
}
