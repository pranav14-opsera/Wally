import { createHash } from 'node:crypto';

import type { Logger } from 'pino';

import type { IAgentJobRepository, IRepository, JobStep, SpecRegistryEntry } from '../../adapters/data/index.js';
import { discoverToolSpec } from '../integration/spec-fetcher.js';
import type { DiscoveredEndpoint, DiscoverToolSpecOptions, DiscoveredSpec } from '../integration/spec-fetcher.js';
import type { JobEventBus } from '../../gateway/events/job-events.js';
import { BaseAgent } from '../base/base-agent.js';
import type { AgentStepDefinition } from '../base/types.js';
import type { ApiLifecycleRunRequest } from './schemas.js';

export interface ApiLifecycleContext {
  request: ApiLifecycleRunRequest;
}

type ChangeType = 'endpoint_removed' | 'endpoint_added' | 'param_added_required' | 'param_relaxed';
type Severity = 'breaking' | 'non_breaking';

export interface ApiChange {
  type: ChangeType;
  severity: Severity;
  method: string;
  path: string;
  detail: string;
}

export interface ApiLifecycleReport {
  apiName: string;
  specFound: boolean;
  specUrl: string | null;
  isBaseline: boolean;
  previousCheckedAt: string | null;
  currentEndpointCount: number;
  totalChanges: number;
  breakingCount: number;
  nonBreakingCount: number;
  changes: ApiChange[];
}

export interface ApiLifecycleAgentDeps {
  jobId: string;
  agentJobs: IAgentJobRepository;
  jobSteps: IRepository<JobStep>;
  specRegistry: IRepository<SpecRegistryEntry>;
  logger: Logger;
  events: JobEventBus;
  minStepDurationMs: number;
  specFetchOptions: DiscoverToolSpecOptions;
}

function endpointKey(endpoint: { method: string; path: string }): string {
  return `${endpoint.method} ${endpoint.path}`;
}

/** Real diff against two genuinely fetched/stored endpoint lists — not mocked. */
function diffEndpoints(previous: DiscoveredEndpoint[], next: DiscoveredEndpoint[]): ApiChange[] {
  const previousByKey = new Map(previous.map((endpoint) => [endpointKey(endpoint), endpoint]));
  const nextByKey = new Map(next.map((endpoint) => [endpointKey(endpoint), endpoint]));
  const changes: ApiChange[] = [];

  for (const [key, endpoint] of previousByKey) {
    if (!nextByKey.has(key)) {
      changes.push({
        type: 'endpoint_removed',
        severity: 'breaking',
        method: endpoint.method,
        path: endpoint.path,
        detail: `${key} was removed since the last check — any client still calling it will now fail`,
      });
    }
  }

  for (const [key, endpoint] of nextByKey) {
    if (!previousByKey.has(key)) {
      changes.push({
        type: 'endpoint_added',
        severity: 'non_breaking',
        method: endpoint.method,
        path: endpoint.path,
        detail: `${key} is new since the last check — purely additive`,
      });
    }
  }

  for (const [key, previousEndpoint] of previousByKey) {
    const nextEndpoint = nextByKey.get(key);
    if (!nextEndpoint) {
      continue;
    }
    const addedRequired = nextEndpoint.requiredParams.filter((param) => !previousEndpoint.requiredParams.includes(param));
    const removedRequired = previousEndpoint.requiredParams.filter((param) => !nextEndpoint.requiredParams.includes(param));

    if (addedRequired.length > 0) {
      changes.push({
        type: 'param_added_required',
        severity: 'breaking',
        method: previousEndpoint.method,
        path: previousEndpoint.path,
        detail: `${key} now requires [${addedRequired.join(', ')}] — existing callers omitting them will now fail`,
      });
    }
    if (removedRequired.length > 0) {
      changes.push({
        type: 'param_relaxed',
        severity: 'non_breaking',
        method: previousEndpoint.method,
        path: previousEndpoint.path,
        detail: `${key} no longer requires [${removedRequired.join(', ')}] — existing callers are unaffected`,
      });
    }
  }

  return changes;
}

/**
 * API Lifecycle Agent (WO-100-103): fetches the REAL current public spec
 * for any named tool (reusing the Integration Agent's spec-fetcher — same
 * verified registry, same honest "not found" path for closed APIs) and
 * diffs it against the last snapshot this agent itself stored for that
 * name in `SpecRegistryEntry`. The first run for a given name has
 * nothing to compare against and is reported as the baseline; every
 * subsequent run is a real diff against real data, not two canned spec
 * versions.
 */
export class ApiLifecycleAgent extends BaseAgent<ApiLifecycleContext> {
  protected readonly steps: ReadonlyArray<AgentStepDefinition<ApiLifecycleContext>>;

  private current: DiscoveredSpec | undefined;
  private previousSnapshot: SpecRegistryEntry | undefined;
  private changes: ApiChange[] = [];

  public constructor(private readonly deps: ApiLifecycleAgentDeps) {
    super(deps.jobId, deps.agentJobs, deps.jobSteps, deps.logger, deps.events, deps.minStepDurationMs);

    this.steps = [
      { name: 'fetch_current_spec', run: (context) => this.fetchCurrentSpec(context) },
      { name: 'load_previous_snapshot', run: (context) => this.loadPreviousSnapshot(context) },
      { name: 'diff_specs', run: () => this.diffSpecs() },
      { name: 'classify_changes', run: () => this.classifyChanges() },
      { name: 'save_snapshot_and_report', run: (context) => this.saveSnapshotAndReport(context) },
    ];
  }

  private async fetchCurrentSpec(context: ApiLifecycleContext): Promise<void> {
    this.current = await discoverToolSpec(context.request.apiName, this.deps.specFetchOptions);
  }

  private async loadPreviousSnapshot(context: ApiLifecycleContext): Promise<void> {
    const previous = await this.deps.specRegistry.findMany(
      { api_name: { operator: 'eq', value: context.request.apiName.trim() } },
      { created_at: 'desc' },
      { kind: 'offset', limit: 1, offset: 0 },
    );
    this.previousSnapshot = previous.items[0];
  }

  private async diffSpecs(): Promise<void> {
    if (!this.current) {
      throw new Error('fetch_current_spec step did not produce a result');
    }
    if (!this.previousSnapshot || !this.current.matched) {
      this.changes = [];
      return;
    }
    const previousEndpoints = (this.previousSnapshot.spec_content.endpoints ?? []) as DiscoveredEndpoint[];
    this.changes = diffEndpoints(previousEndpoints, this.current.endpoints);
  }

  private async classifyChanges(): Promise<void> {
    // Severity is already assigned per-change inside diffSpecs — this
    // step exists as its own visible phase (WO-102) and place to extend
    // classification rules without touching the diff algorithm itself.
    if (this.changes.length === 0) {
      this.deps.logger.info({ jobId: this.deps.jobId }, 'No breaking or non-breaking changes detected');
    }
  }

  private async saveSnapshotAndReport(context: ApiLifecycleContext): Promise<void> {
    if (!this.current) {
      throw new Error('Prior steps did not complete successfully');
    }

    if (this.current.matched) {
      const checksum = createHash('sha256').update(JSON.stringify(this.current.endpoints)).digest('hex');
      await this.deps.specRegistry.create({
        api_name: context.request.apiName.trim(),
        version: new Date().toISOString(),
        spec_content: { endpoints: this.current.endpoints, specUrl: this.current.specUrl },
        checksum,
      });
    }

    const report: ApiLifecycleReport = {
      apiName: this.current.toolName,
      specFound: this.current.matched,
      specUrl: this.current.matched ? this.current.specUrl : null,
      isBaseline: !this.previousSnapshot,
      previousCheckedAt: this.previousSnapshot?.created_at.toISOString() ?? null,
      currentEndpointCount: this.current.totalEndpointCount,
      totalChanges: this.changes.length,
      breakingCount: this.changes.filter((change) => change.severity === 'breaking').length,
      nonBreakingCount: this.changes.filter((change) => change.severity === 'non_breaking').length,
      changes: this.changes,
    };

    await this.deps.agentJobs.update(this.deps.jobId, { result_summary: report as unknown as Record<string, unknown> });
    this.publishCompletedResult(report);
  }
}
