import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installGlobalErrorHandlers } from "./lib/errorLogger";
import "./styles/theme.css";
import "./styles/mobile.css";
import { setStatusBarGreen, hideSplash } from "./lib/native";

// Catch unhandled JS errors + promise rejections globally
installGlobalErrorHandlers();

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container #root not found in index.html");
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);

// Native app: configure status bar and hide splash after React renders.
void setStatusBarGreen();
void hideSplash();

// Detect Capacitor — set by the Capacitor bridge before our JS runs.
const isCapacitorApp = !!(window as unknown as Record<string, unknown>)["Capacitor"];

if (isCapacitorApp) {
  // Hard reset any stale Service Worker + caches left over from a previous
  // APK install. Capacitor's Android WebView storage persists across APK
  // upgrades, so an SW registered by an earlier build can keep serving cached
  // failed (status 0) responses for /v1/* indefinitely. We never want an SW
  // inside the native app because the bundle is already shipped locally.
  void (async () => {
    try {
      let didCleanup = false;
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        if (regs.length > 0) didCleanup = true;
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        if (keys.length > 0) didCleanup = true;
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      // The SW remains in control of the page until the next navigation —
      // reload once to ensure subsequent fetches bypass it entirely.
      if (didCleanup && navigator.serviceWorker?.controller) {
        window.location.reload();
      }
    } catch {
      /* ignore — best-effort cleanup */
    }
  })();
} else if (import.meta.env.PROD) {
  // Browser PWA only: register SW with prompt-based update flow.
  const updateSW = registerSW({
    onNeedRefresh() {
      window.dispatchEvent(new CustomEvent("sw-update-available", { detail: { updateSW } }));
    },
    onOfflineReady() {
      window.dispatchEvent(new CustomEvent("sw-offline-ready"));
    },
  });
}
