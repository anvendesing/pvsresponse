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

export const registerMobilePwa = () => {
  if (!isMobileRoute()) return;
  if (!("serviceWorker" in navigator)) return;
  // Register lazily so the desktop bundle never pulls the SW in.
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/m/" })
      .catch((err) => {
        console.warn("[pwa] service worker registration failed", err);
      });
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
  return () => listeners.delete(cb);
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
