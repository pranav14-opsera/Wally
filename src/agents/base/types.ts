export interface AgentStepDefinition<TContext> {
  readonly name: string;
  run(context: TContext): Promise<void>;
}
