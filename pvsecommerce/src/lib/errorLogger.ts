// Central client-side error logger.
// Logs to console in dev, and ships a compact payload to the backend
// via trackActivity (best-effort, fire-and-forget) in all environments.

const BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "http://localhost:4000/v1";

interface ErrorMeta {
  source?: string;
  componentStack?: string;
  url?: string;
  [key: string]: unknown;
}

let _queue: Array<() => void> = [];
let _flushing = false;

/** Debounced flush so rapid errors don't spam the API */
function enqueue(fn: () => void) {
  _queue.push(fn);
  if (_flushing) return;
  _flushing = true;
  setTimeout(() => {
    const batch = _queue.splice(0);
    _flushing = false;
    batch.forEach((f) => {
      try { f(); } catch { /* ignore */ }
    });
  }, 300);
}

export function logClientError(error: Error | unknown, meta: ErrorMeta = {}): void {
  const err = error instanceof Error ? error : new Error(String(error));

  // Always log locally
  if (import.meta.env.DEV) {
    console.error("[ErrorLogger]", err, meta);
  } else {
    console.error(err.message);
  }

  // Fire-and-forget to backend
  enqueue(() => {
    const body = JSON.stringify({
      event: "client_error",
      meta: {
        message: err.message,
        stack: err.stack?.slice(0, 1200),
        url: meta.url ?? window.location.href,
        source: meta.source ?? "global",
        componentStack: meta.componentStack?.slice(0, 800),
        ua: navigator.userAgent.slice(0, 200),
        ts: new Date().toISOString(),
      },
    });

    // Use sendBeacon when available so the request survives page unload
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(`${BASE}/storefront-mock/activity`, blob);
    } else {
      fetch(`${BASE}/storefront-mock/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => { /* best-effort */ });
    }
  });
}

/** Install window-level handlers once at app startup */
export function installGlobalErrorHandlers(): void {
  window.addEventListener("error", (event) => {
    // Ignore cross-origin script errors (no useful info available)
    if (!event.error && !event.message) return;
    logClientError(event.error ?? new Error(event.message ?? "Script error"), {
      source: "window.onerror",
      url: event.filename,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    logClientError(
      reason instanceof Error ? reason : new Error(String(reason ?? "Unhandled promise rejection")),
      { source: "unhandledrejection" }
    );
  });
}
