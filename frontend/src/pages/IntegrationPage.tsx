import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { apiFetch, ApiRequestError } from '../lib/api';
import { StatusPill, toneForJobStatus } from '../components/StatusPill';

interface AgentJobSummary {
  id: string;
  status: string;
  input_params: { toolName?: string };
  created_at: string;
}

const EXAMPLE_TOOLS = ['GitHub', 'Stripe', 'OpenAI', 'Grok', 'Petstore'];

export function IntegrationPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<AgentJobSummary[]>([]);
  const [toolName, setToolName] = useState('GitHub');
  const [apiKey, setApiKey] = useState('demo-api-key-000');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadJobs(): Promise<void> {
    const result = await apiFetch<AgentJobSummary[]>('/api/v1/agents/integration/runs?page=1&limit=20');
    setJobs(result);
  }

  useEffect(() => {
    loadJobs().catch(() => {});
  }, []);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiFetch<{ jobId: string }>('/api/v1/agents/integration/runs', {
        method: 'POST',
        body: JSON.stringify({ toolName, apiKey }),
      });
      navigate(`/integration/${result.jobId}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to start integration run.');
    } finally {
      setSubmitting(false);
    }
  }

  const canTrigger = user?.role === 'admin' || user?.role === 'manager';

  return (
    <div className="load-tests-page">
      <h1>API Tester</h1>
      <p className="run-status-line">
        Type any tool or API name — the agent fetches its real public OpenAPI spec (when one exists), discovers its
        endpoints, validates credentials, tests a live endpoint, and registers it.
      </p>

      {canTrigger ? (
        <form onSubmit={(event) => void handleSubmit(event)} className="loadtest-form card">
          <h2>Onboard a tool</h2>
          <div className="form-row">
            <label>
              Tool or API name
              <input value={toolName} onChange={(event) => setToolName(event.target.value)} placeholder="e.g. GitHub, Stripe, Grok" required />
            </label>
            <label>
              API key
              <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} required />
            </label>
          </div>
          <p className="run-status-line">
            Try:{' '}
            {EXAMPLE_TOOLS.map((name, index) => (
              <span key={name}>
                <button type="button" className="btn-link" onClick={() => setToolName(name)}>
                  {name}
                </button>
                {index < EXAMPLE_TOOLS.length - 1 ? ', ' : ''}
              </span>
            ))}
          </p>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Starting…' : 'Run integration'}
          </button>
        </form>
      ) : (
        <p className="viewer-notice card">You have read-only access — only Managers and Admins can trigger new runs.</p>
      )}

      <h2>Recent runs</h2>
      <table className="jobs-table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Status</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {jobs.length === 0 && (
            <tr>
              <td colSpan={3} className="empty-row">
                No runs yet.
              </td>
            </tr>
          )}
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>
                <Link to={`/integration/${job.id}`}>{job.input_params.toolName ?? job.id}</Link>
              </td>
              <td>
                <StatusPill tone={toneForJobStatus(job.status)} label={job.status} />
              </td>
              <td>{new Date(job.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
