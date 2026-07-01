// React class-based Error Boundary.
// Catches rendering errors anywhere in the subtree, logs them, and shows
// a friendly recovery screen instead of a blank/broken page.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { logClientError } from "@/lib/errorLogger";

interface Props {
  children: ReactNode;
  /** Optional fallback to render instead of the default recovery UI */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logClientError(error, {
      source: "ErrorBoundary",
      componentStack: info.componentStack ?? undefined,
    });
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    return <ErrorScreen error={error} onReset={this.reset} />;
  }
}

// ── Default error screen ─────────────────────────────────────────────────────

interface ErrorScreenProps {
  error: Error;
  onReset: () => void;
}

function ErrorScreen({ error, onReset }: ErrorScreenProps) {
  const isDev = import.meta.env.DEV;

  return (
    <div className="error-screen" role="alert" aria-live="assertive">
      <div className="error-screen__card">
        {/* Icon */}
        <div className="error-screen__icon" aria-hidden="true">
          <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="32" cy="32" r="30" stroke="currentColor" strokeWidth="3" opacity="0.15" />
            <path
              d="M32 18v16M32 42v2"
              stroke="currentColor"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <h1 className="error-screen__title">Something went wrong</h1>
        <p className="error-screen__body">
          We hit an unexpected error. Our team has been notified. You can try
          refreshing the page or go back to continue shopping.
        </p>

        {isDev && (
          <details className="error-screen__details">
            <summary>Developer details</summary>
            <pre>{error.message}</pre>
            <pre className="error-screen__stack">{error.stack}</pre>
          </details>
        )}

        <div className="error-screen__actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onReset}
          >
            Try again
          </button>
          <a href="/" className="btn btn-outline">
            Back to home
          </a>
        </div>
      </div>
    </div>
  );
}
