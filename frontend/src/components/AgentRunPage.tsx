import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useJobEvents } from '../hooks/useJobEvents';
import type { JobEvent } from '../hooks/useJobEvents';
import { apiFetch } from '../lib/api';
import { StatusPill, toneForJobStatus } from './StatusPill';

interface JobStepDetail {
  step_name: string;
  status: string;
  duration_ms: number | null;
}

interface JobDetail {
  id: string;
  status: string;
  error_message: string | null;
  job_steps: JobStepDetail[];
}

const TERMINAL_EVENT_TYPES = new Set(['completed', 'failed', 'step_completed']);
const IN_FLIGHT_STATUSES = new Set(['queued', 'running']);

function formatEvent(event: JobEvent): string {
  const stepName = typeof event.stepName === 'string' ? event.stepName : undefined;
  switch (event.type) {
    case 'step_started':
      return `▶ ${stepName ?? 'step'} started`;
    case 'step_completed':
      return `✓ ${stepName ?? 'step'} completed`;
    case 'step_progress':
      return `… ${stepName ?? 'step'}${typeof event.elapsedSeconds === 'number' ? ` — ${event.elapsedSeconds}s elapsed` : ''}`;
    case 'failed':
      return `✕ ${stepName ?? 'run'} failed${typeof event.error === 'string' ? `: ${event.error}` : ''}`;
    case 'completed':
      return '✓ Run completed';
    default:
      return event.type;
  }
}

export interface AgentRunPageProps<TResult> {
  title: string;
  backLink: string;
  fetchPath: string;
  renderResult: (result: TResult) => ReactNode;
}

/** Shared run-detail view for every agent (Load Testing, Integration, API Lifecycle): status, persisted steps, the agent-specific result panel, and — only while a run is actually in flight — a live SSE log. Once a job finishes, the Steps list already shows everything the log would; repeating it as a wall of raw events is clutter, not information. */
export function AgentRunPage<TResult>({ title, backLink, fetchPath, renderResult }: AgentRunPageProps<TResult>) {
  const { jobId } = useParams<{ jobId: string }>();
  const liveEvents = useJobEvents(jobId);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [result, setResult] = useState<TResult | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  async function refresh(): Promise<void> {
    if (!jobId) {
      return;
    }
    const data = await apiFetch<{ job: JobDetail; result: TResult | null }>(fetchPath);
    setJob(data.job);
    setResult(data.result);
  }

  useEffect(() => {
    refresh().catch(() => {
      /* the SSE stream (if the run is still in flight) will still surface progress even if this one poll misses */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh reads jobId via closure; re-running on jobId change alone is correct here
  }, [jobId]);

  useEffect(() => {
    const lastEvent = liveEvents[liveEvents.length - 1];
    if (!lastEvent) {
      return;
    }
    if (lastEvent.type === 'step_progress' && typeof lastEvent.elapsedSeconds === 'number') {
      setElapsedSeconds(lastEvent.elapsedSeconds);
    }
    if (TERMINAL_EVENT_TYPES.has(lastEvent.type)) {
      refresh().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh reads jobId via closure; re-running on liveEvents change alone is correct here
  }, [liveEvents]);

  if (!job) {
    return <div className="page-loading">Loading run…</div>;
  }

  const isInFlight = IN_FLIGHT_STATUSES.has(job.status);

  return (
    <div className="run-page">
      <Link to={backLink} className="back-link">
        ← All runs
      </Link>
      <h1>{title}</h1>
      <p className="run-status-line">
        Status: <StatusPill tone={toneForJobStatus(job.status)} label={job.status} />
        {job.status === 'running' && <span className="elapsed"> · {elapsedSeconds}s elapsed</span>}
      </p>
      {job.error_message && <p className="form-error">{job.error_message}</p>}

      <h2>Steps</h2>
      <ul className="steps-list">
        {job.job_steps.map((step) => (
          <li key={step.step_name} className={`step step-${step.status}`}>
            <span className="step-name">{step.step_name}</span>
            <StatusPill tone={toneForJobStatus(step.status)} label={step.status} />
            {step.duration_ms !== null && <span className="step-duration">{step.duration_ms}ms</span>}
          </li>
        ))}
      </ul>

      {result && renderResult(result)}

      {isInFlight && (
        <>
          <h2>Live log</h2>
          <ul className="events-log">
            {liveEvents.length === 0 && <li className="empty-row">Connecting…</li>}
            {liveEvents.map((event, index) => (
              <li key={index}>{formatEvent(event)}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
