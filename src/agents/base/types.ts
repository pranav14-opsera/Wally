export interface IBaseAgent {
  readonly name: string;
  run(): Promise<void>;
}
