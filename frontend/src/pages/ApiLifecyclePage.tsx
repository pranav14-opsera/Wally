import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { apiFetch, ApiRequestError } from '../lib/api';
import { StatusPill, toneForJobStatus } from '../components/StatusPill';

interface AgentJobSummary {
  id: string;
  status: string;
  input_params: { apiName?: string };
  created_at: string;
}

const EXAMPLE_APIS = ['GitHub', 'Stripe', 'Petstore'];

export function ApiLifecyclePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<AgentJobSummary[]>([]);
  const [apiName, setApiName] = useState('GitHub');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadJobs(): Promise<void> {
    const result = await apiFetch<AgentJobSummary[]>('/api/v1/agents/api-lifecycle/runs?page=1&limit=20');
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
      const result = await apiFetch<{ jobId: string }>('/api/v1/agents/api-lifecycle/runs', {
        method: 'POST',
        body: JSON.stringify({ apiName }),
      });
      navigate(`/api-lifecycle/${result.jobId}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to start API lifecycle run.');
    } finally {
      setSubmitting(false);
    }
  }

  const canTrigger = user?.role === 'admin' || user?.role === 'manager';

  return (
    <div className="load-tests-page">
      <h1>API Lifecycle Agent</h1>
      <p className="run-status-line">
        Fetches the real current spec for any API and diffs it against the last time this agent checked it — the
        first run for a name records a baseline; every run after that is a genuine breaking-change report.
      </p>

      {canTrigger ? (
        <form onSubmit={(event) => void handleSubmit(event)} className="loadtest-form card">
          <h2>Check for breaking changes</h2>
          <div className="form-row">
            <label>
              API name
              <input value={apiName} onChange={(event) => setApiName(event.target.value)} placeholder="e.g. GitHub, Stripe" required />
            </label>
          </div>
          <p className="run-status-line">
            Try:{' '}
            {EXAMPLE_APIS.map((name, index) => (
              <span key={name}>
                <button type="button" className="btn-link" onClick={() => setApiName(name)}>
                  {name}
                </button>
                {index < EXAMPLE_APIS.length - 1 ? ', ' : ''}
              </span>
            ))}
          </p>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Starting…' : 'Run comparison'}
          </button>
        </form>
      ) : (
        <p className="viewer-notice card">You have read-only access — only Managers and Admins can trigger new runs.</p>
      )}

      <h2>Recent runs</h2>
      <table className="jobs-table">
        <thead>
          <tr>
            <th>API</th>
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
                <Link to={`/api-lifecycle/${job.id}`}>{job.input_params.apiName ?? job.id}</Link>
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
