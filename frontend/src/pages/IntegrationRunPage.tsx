import { useParams } from 'react-router-dom';

import { AgentRunPage } from '../components/AgentRunPage';

interface DiscoveredEndpoint {
  method: string;
  path: string;
  summary: string;
  responseShape: string[];
  requiredParams: string[];
}

interface LiveTestResult {
  attempted: boolean;
  description: string | null;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
}

interface IntegrationReport {
  toolName: string;
  specFound: boolean;
  specUrl: string | null;
  attemptedUrls: string[];
  totalEndpointCount: number;
  endpoints: DiscoveredEndpoint[];
  credentialStored: boolean;
  liveTest: LiveTestResult;
  registryEntryId: string | null;
}

function renderIntegrationResult(result: IntegrationReport) {
  if (!result.specFound) {
    return (
      <div className="results card">
        <h2>No public API specification found for "{result.toolName}"</h2>
        <p className="run-status-line">This tool doesn't publish a machine-readable spec at any of the locations checked — a common, honest outcome for closed/authenticated-only APIs.</p>
        <p className="run-status-line">URLs checked:</p>
        <ul className="events-log">
          {result.attemptedUrls.map((url) => (
            <li key={url}>{url}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="results card">
      <h2>
        {result.toolName} — {result.totalEndpointCount} real endpoint{result.totalEndpointCount === 1 ? '' : 's'} discovered
      </h2>
      <p className="run-status-line">
        Source: <a href={result.specUrl ?? undefined} target="_blank" rel="noreferrer">{result.specUrl}</a>
      </p>
      <dl className="metrics-grid">
        <div>
          <dt>Credential stored</dt>
          <dd>{result.credentialStored ? 'Yes' : 'No'}</dd>
        </div>
        <div>
          <dt>Live test</dt>
          <dd>
            {result.liveTest.attempted
              ? `${result.liveTest.statusCode ?? 'error'} · ${result.liveTest.latencyMs}ms`
              : 'Not attempted'}
          </dd>
        </div>
      </dl>
      {result.liveTest.description && <p className="run-status-line">{result.liveTest.description}</p>}
      {result.liveTest.error && <p className="form-error">{result.liveTest.error}</p>}

      <h2>Discovered endpoints (showing up to {result.endpoints.length} of {result.totalEndpointCount})</h2>
      <ul className="steps-list">
        {result.endpoints.map((endpoint) => (
          <li key={`${endpoint.method} ${endpoint.path}`} className="step step-completed">
            <span className="step-name">
              {endpoint.method} {endpoint.path}
              {endpoint.summary ? ` — ${endpoint.summary}` : ''}
            </span>
            {endpoint.responseShape.length > 0 && (
              <span className="step-duration">{'{'}{endpoint.responseShape.join(', ')}{'}'}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function IntegrationRunPage() {
  const { jobId } = useParams<{ jobId: string }>();
  return (
    <AgentRunPage<IntegrationReport>
      title="API Tester Run"
      backLink="/integration"
      fetchPath={`/api/v1/agents/integration/runs/${jobId}`}
      renderResult={renderIntegrationResult}
    />
  );
}
