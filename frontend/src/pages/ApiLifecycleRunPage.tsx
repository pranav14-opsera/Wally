import { useParams } from 'react-router-dom';

import { AgentRunPage } from '../components/AgentRunPage';
import { StatusPill, toneForVerdict } from '../components/StatusPill';

interface ApiChange {
  type: string;
  severity: 'breaking' | 'non_breaking';
  method: string;
  path: string;
  detail: string;
}

interface ApiLifecycleReport {
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

function renderApiLifecycleResult(result: ApiLifecycleReport) {
  if (!result.specFound) {
    return (
      <div className="results card">
        <h2>No public API specification found for "{result.apiName}"</h2>
        <p className="run-status-line">Nothing to diff without a real spec to fetch — this API doesn't publish a machine-readable one at any location checked.</p>
      </div>
    );
  }

  if (result.isBaseline) {
    return (
      <div className="results card">
        <h2>{result.apiName} — baseline recorded</h2>
        <p className="run-status-line">
          First time checking this API — {result.currentEndpointCount} endpoints captured as the baseline. Run this
          again later to detect real changes since today.
        </p>
      </div>
    );
  }

  return (
    <div className="results card">
      <h2>{result.apiName} — compared against the last check</h2>
      <p className="run-status-line">Previous check: {result.previousCheckedAt ? new Date(result.previousCheckedAt).toLocaleString() : 'unknown'}</p>
      <dl className="metrics-grid">
        <div>
          <dt>Total changes</dt>
          <dd>{result.totalChanges}</dd>
        </div>
        <div>
          <dt>Breaking</dt>
          <dd className="verdict-fail">{result.breakingCount}</dd>
        </div>
        <div>
          <dt>Non-breaking</dt>
          <dd className="verdict-pass">{result.nonBreakingCount}</dd>
        </div>
      </dl>

      <h2>Changes</h2>
      <ul className="steps-list">
        {result.changes.length === 0 && <li className="empty-row">No differences found since the last check.</li>}
        {result.changes.map((change, index) => (
          <li key={index} className="step">
            <span className="step-name">{change.detail}</span>
            <StatusPill tone={toneForVerdict(change.severity)} label={change.severity === 'breaking' ? 'breaking' : 'non-breaking'} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ApiLifecycleRunPage() {
  const { jobId } = useParams<{ jobId: string }>();
  return (
    <AgentRunPage<ApiLifecycleReport>
      title="API Lifecycle Run"
      backLink="/api-lifecycle"
      fetchPath={`/api/v1/agents/api-lifecycle/runs/${jobId}`}
      renderResult={renderApiLifecycleResult}
    />
  );
}
