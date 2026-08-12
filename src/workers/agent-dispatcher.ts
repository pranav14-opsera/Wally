import type { JobResult } from '../agents/types.js';

export class UnknownAgentTypeError extends Error {
  public constructor(
    public readonly agentType: string,
    public readonly registeredTypes: readonly string[],
  ) {
    super(
      `No agent registered for type "${agentType}". Registered types: ${
        registeredTypes.length > 0 ? registeredTypes.join(', ') : '(none)'
      }.`,
    );
    this.name = 'UnknownAgentTypeError';
  }
}

/**
 * The minimal structural shape `AgentDispatcher` needs — every concrete
 * `BaseAgent<TInput, TOutput>` subclass (Integration/Validation/Load
 * Testing/API Lifecycle, none of which exist in the codebase yet)
 * satisfies this without a cast, since TS checks class methods (not
 * arrow-function properties) bivariantly: an `execute(jobId, input:
 * SomeNarrowerInput)` method is assignable here even though `TInput`
 * itself varies per subclass. This avoids a registry typed `BaseAgent<any,
 * any>`, which the project's `no-explicit-any` rule (error, no
 * precedent for disabling anywhere else in this codebase) would reject.
 */
export interface DispatchableAgent {
  execute(jobId: string, input: Record<string, unknown>): Promise<JobResult>;
}

type AgentFactory = () => DispatchableAgent;

/**
 * Maps an `agentType` string (from job data) to the `BaseAgent` subclass
 * that handles it — a runtime `Map`, not a hardcoded switch/if-else, per
 * this WO's constraint. No concrete agent (Integration/Validation/Load
 * Testing/API Lifecycle) exists in the codebase yet — those land in
 * later WOs, each adding exactly one `register()` call here. The worker
 * entrypoint creates a BullMQ `Worker` only for types that are actually
 * registered (`registeredTypes()`), so this same registry is also the
 * single source of truth for "which queues does this worker process
 * consume" — no separate hardcoded agent-type list to keep in sync.
 */
export class AgentDispatcher {
  private readonly factories = new Map<string, AgentFactory>();

  public register(agentType: string, factory: AgentFactory): void {
    this.factories.set(agentType, factory);
  }

  public isRegistered(agentType: string): boolean {
    return this.factories.has(agentType);
  }

  public registeredTypes(): string[] {
    return [...this.factories.keys()];
  }

  /** Resolves `agentType` to a fresh agent instance and runs it. Throws `UnknownAgentTypeError` (a usage/config error, not a job-domain failure) for an unregistered type — the caller (the worker processor) lets this propagate so BullMQ marks the job failed without retrying indefinitely. */
  public async dispatch(agentType: string, jobId: string, input: Record<string, unknown>): Promise<JobResult> {
    const factory = this.factories.get(agentType);
    if (!factory) {
      throw new UnknownAgentTypeError(agentType, this.registeredTypes());
    }
    const agent = factory();
    return agent.execute(jobId, input);
  }
}
