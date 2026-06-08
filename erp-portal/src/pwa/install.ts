// PWA install + service-worker registration helpers.
//
// We only register the SW when the user is inside /m/* (the warehouse
// mobile shell). The desktop ERP at /erp keeps working without a
// service worker - this is intentional so we don't accidentally cache
// stale desktop bundles for office users.
//
// The "Add to Home Screen" prompt is intercepted here and exposed via
// the `installApp` helper, which mobile screens call from a button.

declare global {
  interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  }
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(ready: boolean) => void>();

const isMobileRoute = () => window.location.pathname.startsWith("/m");

// One-shot recovery: visiting /m/?reset=1 unregisters every service
// worker, deletes every cache, and reloads. Use this when a phone is
// stuck on a stale bundle and the natural update cycle is too slow.
const handleResetIfRequested = async () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("reset") !== "1") return false;
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) {
    console.warn("[pwa] reset failed", e);
  }
  // Strip ?reset=1 then hard reload so the new SW + bundle install fresh.
  const url = new URL(window.location.href);
  url.searchParams.delete("reset");
  window.location.replace(url.toString());
  return true;
};

export const registerMobilePwa = () => {
  if (!isMobileRoute()) return;
  if (!("serviceWorker" in navigator)) return;
  // Register lazily so the desktop bundle never pulls the SW in.
  window.addEventListener("load", async () => {
    if (await handleResetIfRequested()) return;
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", {
        scope: "/m/",
      });

      // Force an update check now and every 60s while the app is open.
      // Chrome only auto-checks sw.js on navigation; an installed
      // standalone PWA can sit on a home screen for days without ever
      // re-fetching it. Polling guarantees the v2+ SW with the
      // skipWaiting handler eventually replaces the old one.
      const triggerUpdate = () => {
        reg.update().catch(() => undefined);
      };
      triggerUpdate();
      setInterval(triggerUpdate, 60_000);

      // When a fresh SW finishes installing alongside an existing
      // controller, ask it to take over and reload the page so the
      // user sees the new bundle without manual cache clearing.
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (
            worker.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            worker.postMessage("skipWaiting");
          }
        });
      });

      // Reload exactly once when the controller swaps to the new SW.
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });
    } catch (err) {
      console.warn("[pwa] service worker registration failed", err);
    }
  });
};

export const watchInstallPrompt = () => {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    listeners.forEach((cb) => cb(true));
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    listeners.forEach((cb) => cb(false));
  });
};

export const isInstallReady = () => deferredPrompt !== null;

export const onInstallReadyChange = (cb: (ready: boolean) => void) => {
  listeners.add(cb);
  cb(isInstallReady());
  return () => {
    listeners.delete(cb);
  };
};

export const installApp = async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
  if (!deferredPrompt) return "unavailable";
  await deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  deferredPrompt = null;
  listeners.forEach((cb) => cb(false));
  return choice.outcome;
};

// True when the app is running standalone (installed). Useful for
// hiding "install" prompts and showing a small offline banner.
export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  // iOS Safari
  (navigator as { standalone?: boolean }).standalone === true;
