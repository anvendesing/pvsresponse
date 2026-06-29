// Persistent anonymous visitor ID.
// Stored in localStorage["pv_anon_id"] so it survives page reloads and
// browser restarts. A new UUID is generated on first visit.
//
// For Capacitor native builds, the same key is also synced to
// @capacitor/preferences if available — the web shim falls back to
// localStorage transparently.

const KEY = "pv_anon_id";

function uuidv4(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for old WebViews.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let cached: string | null = null;

export function getAnonId(): string {
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) {
      cached = stored;
      return cached;
    }
  } catch {
    // localStorage blocked (private browsing with strict settings, etc.)
  }
  const id = uuidv4();
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // ignore
  }
  cached = id;
  return id;
}
