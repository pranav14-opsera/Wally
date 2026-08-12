import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { apiFetch, ApiRequestError } from '../lib/api';
import { StatusPill, toneForJobStatus } from '../components/StatusPill';

interface AgentJobSummary {
  id: string;
  status: string;
  input_params: { name?: string; targetUrl?: string };
  created_at: string;
}

export function LoadTestsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<AgentJobSummary[]>([]);
  const [name, setName] = useState('Smoke test');
  const [targetUrl, setTargetUrl] = useState('http://localhost:3000/api/v1/health/live');
  const [vus, setVus] = useState(5);
  const [durationSeconds, setDurationSeconds] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadJobs(): Promise<void> {
    const result = await apiFetch<AgentJobSummary[]>('/api/v1/agents/load-testing/runs?page=1&limit=20');
    setJobs(result);
  }

  useEffect(() => {
    loadJobs().catch(() => {
      /* transient — table just stays empty until the next successful poll */
    });
  }, []);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiFetch<{ jobId: string }>('/api/v1/agents/load-testing/runs', {
        method: 'POST',
        body: JSON.stringify({ name, targetUrl, vus, durationSeconds }),
      });
      navigate(`/load-tests/${result.jobId}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to start the load test run.');
    } finally {
      setSubmitting(false);
    }
  }

  const canTrigger = user?.role === 'admin' || user?.role === 'manager';

  return (
    <div className="load-tests-page">
      <h1>Load Tests</h1>

      {canTrigger ? (
        <form onSubmit={(event) => void handleSubmit(event)} className="loadtest-form card">
          <h2>Run a new load test</h2>
          <div className="form-row">
            <label>
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <label>
              Target URL
              <input value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} type="url" required />
            </label>
          </div>
          <div className="form-row">
            <label>
              Virtual users
              <input value={vus} onChange={(event) => setVus(Number(event.target.value))} type="number" min={1} required />
            </label>
            <label>
              Duration (seconds)
              <input
                value={durationSeconds}
                onChange={(event) => setDurationSeconds(Number(event.target.value))}
                type="number"
                min={1}
                required
              />
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Starting…' : 'Run load test'}
          </button>
        </form>
      ) : (
        <p className="viewer-notice card">You have read-only access — only Managers and Admins can trigger new runs.</p>
      )}

      <h2>Recent runs</h2>
      <table className="jobs-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Target</th>
            <th>Status</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {jobs.length === 0 && (
            <tr>
              <td colSpan={4} className="empty-row">
                No runs yet.
              </td>
            </tr>
          )}
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>
                <Link to={`/load-tests/${job.id}`}>{job.input_params.name ?? job.id}</Link>
              </td>
              <td>{job.input_params.targetUrl}</td>
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
