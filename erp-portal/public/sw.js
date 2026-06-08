// NovaERP Warehouse — minimal app-shell service worker.
//
// Goals for Phase 1:
//   - cache the React shell + manifest + icons so the PWA opens
//     instantly on subsequent launches and handles brief offline
//     blips for navigation,
//   - never cache /v1 API calls (always go to the network),
//   - bypass the desktop /erp routes entirely - this SW only attaches
//     when the user lands inside /m/.
//
// A full offline write queue lands in Phase 1.5; this SW intentionally
// stays small and dumb.

const VERSION = "v2";
const SHELL_CACHE = `nova-mobile-shell-${VERSION}`;

const SHELL_ASSETS = [
  "/m/",
  "/m/tasks",
  "/m/login",
  "/manifest.webmanifest",
  "/icons/wh-192.svg",
  "/icons/wh-512.svg",
  "/icons/wh-maskable.svg",
  "/favicon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        cache.addAll(
          SHELL_ASSETS.map((u) => new Request(u, { cache: "reload" }))
        )
      )
      // skip waiting so the new SW activates immediately on next reload.
      .then(() => self.skipWaiting())
      // network failures during install are non-fatal in dev.
      .catch(() => undefined)
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("nova-mobile-shell-") && k !== SHELL_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // API + auth: always network, never cached.
  if (
    url.pathname.startsWith("/v1/") ||
    url.pathname === "/health" ||
    url.pathname.startsWith("/api/")
  ) {
    return;
  }

  // Only intervene for navigations and same-origin GETs that look
  // like the mobile shell or its assets. Desktop routes pass through
  // untouched.
  const isNavigate = req.mode === "navigate";
  const isMobileNav = isNavigate && url.pathname.startsWith("/m");
  const isShellAsset =
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon.svg";

  if (!isMobileNav && !isShellAsset) return;

  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(req);
        if (fresh.ok && req.url.startsWith(self.location.origin)) {
          const copy = fresh.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
        }
        return fresh;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (isMobileNav) {
          const fallback = await caches.match("/m/");
          if (fallback) return fallback;
        }
        return new Response(
          "<h1>Offline</h1><p>The warehouse app is offline. Please reconnect.</p>",
          { status: 503, headers: { "Content-Type": "text/html" } }
        );
      }
    })()
  );
});

// Push messages aren't wired in Phase 1 but the listener stays so a
// later release can broadcast new-task notifications without bumping
// the SW version.
self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});
