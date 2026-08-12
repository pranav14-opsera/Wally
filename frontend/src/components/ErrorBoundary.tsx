import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryState {
  error: Error | null;
}

/** Last line of defense so a render-time bug shows a recoverable screen instead of a blank white page — the demo should survive an unexpected edge case, not die on it. */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { error: null };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console -- last-resort diagnostic when the boundary catches, no logging service wired up in this local deployment
    console.error('Unhandled UI error', error, info.componentStack);
  }

  public render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }
    return (
      <div className="login-page">
        <div className="login-form">
          <h1>Something went wrong</h1>
          <p className="run-status-line">{this.state.error.message}</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.assign('/')}>
            Back to safety
          </button>
        </div>
      </div>
    );
  }
}
