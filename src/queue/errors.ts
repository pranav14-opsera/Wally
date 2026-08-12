export class RedisConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'RedisConfigurationError';
  }
}

export class QueueInitializationError extends Error {
  public constructor(
    public readonly agentType: string,
    public readonly cause: unknown,
  ) {
    super(
      `Failed to initialize queue for agent type "${agentType}": ` +
        (cause instanceof Error ? cause.message : String(cause)),
    );
    this.name = 'QueueInitializationError';
  }
}
