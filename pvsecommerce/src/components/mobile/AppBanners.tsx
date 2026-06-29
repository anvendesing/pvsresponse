// Offline banner, SW update notification, and PWA install prompt.
// Rendered at app root level — only visible when relevant.

import { useEffect, useState } from "react";

// ── Offline banner ──────────────────────────────────────────────────────────

export const OfflineBanner = () => {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="app-offline-banner" role="status" aria-live="polite">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
        <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <circle cx="12" cy="20" r="1" />
      </svg>
      You're offline — browsing cached content
    </div>
  );
};

// ── SW update toast ─────────────────────────────────────────────────────────

export const SwUpdateToast = () => {
  const [show, setShow] = useState(false);
  const [updateSW, setUpdateSW] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const { detail } = e as CustomEvent<{ updateSW: () => Promise<void> }>;
      setUpdateSW(() => detail.updateSW);
      setShow(true);
    };
    window.addEventListener("sw-update-available", handler);
    return () => window.removeEventListener("sw-update-available", handler);
  }, []);

  if (!show) return null;

  return (
    <div className="sw-update-toast" role="alert">
      <span>A new version is available</span>
      <button
        className="sw-update-toast__btn"
        onClick={() => { updateSW?.(); setShow(false); }}
      >
        Update
      </button>
      <button
        className="sw-update-toast__dismiss"
        onClick={() => setShow(false)}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
};

// ── PWA install prompt (A2HS) ───────────────────────────────────────────────

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export const PwaInstallPrompt = () => {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Don't show if already installed.
  if (!visible || !prompt) return null;

  const handleInstall = async () => {
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") setVisible(false);
  };

  return (
    <div className="pwa-install-banner" role="dialog" aria-label="Install app">
      <img src="/brand/logo.png" alt="Prakruthivanam" className="pwa-install-banner__logo" />
      <div className="pwa-install-banner__text">
        <strong>Add to Home Screen</strong>
        <span>Fast, offline-capable app experience</span>
      </div>
      <button className="pwa-install-banner__btn" onClick={handleInstall}>
        Install
      </button>
      <button
        className="pwa-install-banner__dismiss"
        onClick={() => setVisible(false)}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
};
