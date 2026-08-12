/**
 * Immutable-from-the-outside accumulation of every prior step's result,
 * keyed by step name. Only `BaseAgent` itself (via `set`, package-private
 * in intent though not enforced by TS module privacy) appends entries as
 * each step completes; step handlers only ever read through `get`/`has`.
 */
export class StepContext<TInput extends Record<string, unknown> = Record<string, unknown>> {
  private readonly results = new Map<string, unknown>();

  public constructor(public readonly input: TInput) {}

  /** Records a step's result. Called by BaseAgent after a step handler resolves — never by a step handler itself. */
  public set(stepName: string, value: unknown): void {
    this.results.set(stepName, value);
  }

  public has(stepName: string): boolean {
    return this.results.has(stepName);
  }

  /** Throws if `stepName` hasn't completed yet — a step referencing a result that doesn't exist is a pipeline-ordering bug, not a value that should silently become `undefined`. */
  public get<T>(stepName: string): T {
    if (!this.results.has(stepName)) {
      throw new Error(
        `StepContext.get("${stepName}"): no result recorded for that step — either it hasn't run yet or the name is misspelled. Recorded steps so far: ${
          this.results.size > 0 ? [...this.results.keys()].join(', ') : '(none)'
        }`,
      );
    }
    return this.results.get(stepName) as T;
  }

  /** Snapshot of every recorded step result, keyed by step name — used to build the job's final `result_summary`. */
  public toObject(): Record<string, unknown> {
    return Object.fromEntries(this.results);
  }
}
