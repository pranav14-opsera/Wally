import { useParams } from 'react-router-dom';

import { AgentRunPage } from '../components/AgentRunPage';
import { StatusPill, toneForVerdict } from '../components/StatusPill';

interface LoadTestResultDetail {
  p50_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
  throughput_rps: number;
  error_rate_pct: number;
  slo_verdict: 'pass' | 'fail';
}

function renderLoadTestResult(result: LoadTestResultDetail) {
  return (
    <div className="results card">
      <h2>
        Result — <StatusPill tone={toneForVerdict(result.slo_verdict)} label={result.slo_verdict} />
      </h2>
      <dl className="metrics-grid">
        <div>
          <dt>p50 latency</dt>
          <dd>{result.p50_latency_ms}ms</dd>
        </div>
        <div>
          <dt>p95 latency</dt>
          <dd>{result.p95_latency_ms}ms</dd>
        </div>
        <div>
          <dt>p99 latency</dt>
          <dd>{result.p99_latency_ms}ms</dd>
        </div>
        <div>
          <dt>Throughput</dt>
          <dd>{result.throughput_rps.toFixed(2)} req/s</dd>
        </div>
        <div>
          <dt>Error rate</dt>
          <dd>{result.error_rate_pct.toFixed(2)}%</dd>
        </div>
      </dl>
    </div>
  );
}

export function LoadTestRunPage() {
  const { jobId } = useParams<{ jobId: string }>();
  return (
    <AgentRunPage<LoadTestResultDetail>
      title="Load Test Run"
      backLink="/load-tests"
      fetchPath={`/api/v1/agents/load-testing/runs/${jobId}`}
      renderResult={renderLoadTestResult}
    />
  );
}
