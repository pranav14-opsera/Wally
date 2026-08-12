/** The payload every agent-type queue's jobs carry — `jobId` identifies the pre-existing `AgentJob` row (per BaseAgent's own contract, unchanged since WO-029: `execute()` expects the row to already exist), `input` is passed through to `BaseAgent.execute()` unchanged. */
export interface AgentJobData {
  jobId: string;
  input: Record<string, unknown>;
}

/** What a DLQ entry (queue `{agentType}-dlq`) carries once a job exhausts its retries — the original payload plus enough context to diagnose and potentially replay it manually. */
export interface DeadLetterEntry {
  originalJobId: string;
  agentType: string;
  jobData: AgentJobData;
  failureReason: string;
  failedAt: string;
  attemptsMade: number;
}
