import { useEffect, useState } from 'react';

export interface JobEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Subscribes to `/api/v1/events/jobs/:id` (WO-045) for the lifetime of
 * `jobId`. SSE `:ping` keep-alive comments never reach `onmessage` (the
 * spec excludes lines starting with `:`), so no filtering is needed here
 * for those. Proxied through Vite as same-origin, so plain `EventSource`
 * (no `withCredentials`) already sends the access-token cookie.
 */
export function useJobEvents(jobId: string | undefined): JobEvent[] {
  const [events, setEvents] = useState<JobEvent[]>([]);

  useEffect(() => {
    setEvents([]);
    if (!jobId) {
      return;
    }

    const source = new EventSource(`/api/v1/events/jobs/${jobId}`);
    source.onmessage = (message) => {
      try {
        const parsed = JSON.parse(message.data) as JobEvent;
        setEvents((previous) => [...previous, parsed]);
      } catch {
        // Malformed frame — drop it rather than crash the stream.
      }
    };

    return () => {
      source.close();
    };
  }, [jobId]);

  return events;
}
